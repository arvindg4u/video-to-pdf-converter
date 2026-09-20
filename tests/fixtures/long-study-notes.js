// Deterministic, binary-free long-document fixture shared by unit/browser tests.
export function longStudyNotes(chapters = 60) {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  return '---\ntitle: RAS Complete Notes\nsubject: Indian Polity\n---\n\n' + Array.from({ length: chapters }, (_, i) => `# अध्याय ${i + 1} — Indian Polity

${'Read, recall, and apply each constitutional principle. भारतीय संविधान का अध्ययन करें। '.repeat(12)}

## Fundamental Rights

> [!TIP] Revision
> Recall this topic before the exam.

### अनुच्छेद 14

Equality before the law. $E = mc^2$.

| Article | Meaning |
| --- | --- |
| 14 | Equality |
| 19 | Freedom |

![Diagram](${image})

## Topic ${i + 1}

${'An explanation with **key terms** and examples. '.repeat(12)}

### Practice ${i + 1}

- Remember the principle.
- Test your understanding.

`).join('')
}
