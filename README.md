# 🎬 Video to PDF Converter

**Multiple Videos • Single PDF • 100% Browser-Based • PWA Support**

Ek saath 20 videos ke frames ko ek single PDF mein merge karo!

## ✨ New Features

- ✅ **Multiple Videos Support** - Up to 20 videos ek saath upload karo
- ✅ **Single Merged PDF** - Sabhi videos ke frames ek PDF mein
- ✅ **PWA Support** - App ki tarah install karo
- ✅ **Offline Support** - Ek baar load hone ke baad offline kaam karega
- ✅ **Progress Tracking** - Real-time progress bar with stats
- ✅ **Video Info** - Har frame pe video name aur timestamp
- ✅ **Remove Videos** - Upload ke baad bhi videos remove kar sakte ho

## 🚀 Setup Instructions

### Installation

```bash
npm install
npm run dev
```

Browser mein `http://localhost:3000` kholo

## 📱 PWA Installation

### Desktop (Chrome/Edge):
1. Browser mein app kholo
2. Address bar mein "Install" icon pe click karo
3. Ya Settings → Install app

### Mobile (Android):
1. Browser mein app kholo
2. Menu → "Add to Home Screen"
3. App icon home screen pe aa jayega

### Mobile (iOS):
1. Safari mein app kholo
2. Share button → "Add to Home Screen"

## 📖 Kaise Use Kare

1. **Multiple videos select karo** (max 20)
2. **FPS select karo** (1-6)
3. **Videos list check karo** - unwanted videos remove kar sakte ho
4. **"Merge & Generate PDF" click karo**
5. **Progress dekho** - video-by-video aur frame-by-frame
6. **PDF download karo** - sabhi videos ke frames ek PDF mein!

## 🎯 Features Details

### Multiple Videos
- Maximum 20 videos ek saath
- Total size limit: Browser memory dependent
- Har video ka naam aur timestamp PDF mein show hoga

### Progress Tracking
- Current video number
- Total frames vs processed frames
- Percentage completion
- Real-time progress bar

### PWA Benefits
- Desktop/mobile pe install karo
- Offline kaam karega
- Fast loading
- Native app jaisa experience

## 🛠️ Tech Stack

- **Frontend:** React + Vite
- **Video Processing:** HTML5 Canvas API
- **PDF Generation:** jsPDF
- **PWA:** Service Worker + Web Manifest

## 💡 Tips

- **Chhoti videos se start karo** testing ke liye
- **1-2 FPS kaafi hai** most cases mein
- **Video order matter karta hai** - jo pehle select karoge wo pehle PDF mein aayega
- **Remove button use karo** agar galti se koi video select ho gayi
- **Progress bar dekho** kitna time lagega estimate karne ke liye

## 🔒 Privacy

- ✅ Tumhari videos **kabhi server pe upload nahi hoti**
- ✅ Sab processing **browser mein hoti hai**
- ✅ **Zero cloud storage**
- ✅ **Complete privacy**

Enjoy! 🎉