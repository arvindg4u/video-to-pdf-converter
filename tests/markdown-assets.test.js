import test from 'node:test'
import assert from 'node:assert/strict'
import { ingestAssets, createAssetResolver, validateAssetPath, ASSET_LIMITS } from '../src/markdown/assets.js'
const png = Uint8Array.from([137,80,78,71,13,10,26,10])
const file = (name, bytes = png, path = '') => ({ name, size: bytes.length, webkitRelativePath: path, arrayBuffer: async () => bytes.buffer })
const entry = (path) => ({ path, src: 'data:image/png;base64,iVBORw0KGgo=' })

test('valid nested paths and URL-encoded spaces resolve exactly', async () => {
  const { resolver } = await ingestAssets([file('one image.png', png, 'vault/attachments/one image.png')], { folder: true })
  assert.equal(resolver.size, 1)
  assert.ok(resolver.resolve('attachments/one%20image.png'))
  assert.ok(resolver.resolve('./attachments/one image.png'))
  assert.equal(resolver.resolve('one image.png'), null)
  assert.ok(resolver.resolve('one image.png', { basename: true }))
})
for (const path of ['../../secret.png', 'a/../secret.png', '%2e%2e/secret.png', '%252e%252e/secret.png', '/secret.png', 'C:\\secret.png', 'a\\b.png', '//host/x.png', 'https://host/x.png', 'a\0.png', 'a%00.png', 'a//b.png', 'a.png?x', 'a.png#x', '%zz.png']) {
  test(`reject unsafe path ${JSON.stringify(path)}`, () => {
    assert.equal(validateAssetPath(path), null)
    assert.equal(createAssetResolver([entry('secret.png')]).resolve(path, { basename: true }), null)
  })
}
test('missing and unsupported assets never resolve', () => {
  const resolver = createAssetResolver([entry('ok.png'), entry('bad.svg'), entry('script.html')])
  for (const name of ['missing.png', 'bad.svg', 'script.html']) assert.equal(resolver.resolve(name), null)
})
test('duplicate basenames are ambiguous; explicit paths remain usable', () => {
  const resolver = createAssetResolver([entry('a/x.png'), entry('b/x.png')])
  assert.equal(resolver.resolve('x.png', { basename: true }), null)
  assert.ok(resolver.resolve('a/x.png'))
  assert.equal(createAssetResolver([entry('x.png'), entry('x.png')]).resolve('x.png'), null)
})
test('supported image signatures override untrusted browser MIME', async () => {
  const files = [file('a.PNG'), file('b.jpeg', Uint8Array.from([255,216,255])), file('c.gif', new TextEncoder().encode('GIF89a')), file('d.webp', new TextEncoder().encode('RIFFxxxxWEBP'))]
  const { resolver } = await ingestAssets(files)
  assert.equal(resolver.size, 4)
  assert.match(resolver.resolve('b.jpeg').src, /^data:image\/jpeg;base64,/)
})
test('HTML disguised as PNG is rejected and unsupported files are not read', async () => {
  await assert.rejects(ingestAssets([file('attack.png', new TextEncoder().encode('<script>alert(1)</script>'))]), /Invalid image/)
  const result = await ingestAssets([{ name: 'attack.html', size: 10, arrayBuffer() { throw Error('must not read') } }])
  assert.equal(result.skipped, 1)
})
test('unsafe imported filenames and invalid folder paths reject atomically', async () => {
  await assert.rejects(ingestAssets([file('../x.png')]), /unsafe/)
  await assert.rejects(ingestAssets([file('x.png')], { folder: true }), /unsafe/)
})
test('file count, per-image and total byte budgets enforced before reading', async () => {
  await assert.rejects(ingestAssets(Array(201).fill(file('a.png'))), /200/)
  await assert.rejects(ingestAssets([{ ...file('a.png'), size: ASSET_LIMITS.perFile + 1 }]), /limit/)
  const bytes = new Uint8Array(ASSET_LIMITS.perFile); bytes.set(png)
  await assert.rejects(ingestAssets(Array.from({length: 5}, (_, i) => file(`${i}.png`, bytes))), /limit/)
})
test('read errors propagate without creating partial context', async () => {
  await assert.rejects(ingestAssets([{ name: 'x.png', size: 8, arrayBuffer() { throw Error('read failed') } }]), /read failed/)
})
test('prototype-named extensions are unsupported and never read', async () => {
  const { skipped, resolver } = await ingestAssets([{ name: 'image.constructor', size: 1, arrayBuffer() { throw Error('must not read') } }])
  assert.equal(skipped, 1)
  assert.equal(resolver.size, 0)
})
