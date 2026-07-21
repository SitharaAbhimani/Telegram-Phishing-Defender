# AI-Powered Phishing Defender for Telegram Web 🛡️

A privacy-preserving Chrome Extension that detects phishing URLs, malicious QR codes, and scam voice messages directly inside Telegram Web. All AI processing is done locally on the client-side using TensorFlow.js.

## ✨ Key Features
* **URL Scanning:** Uses a 1D CNN model to classify URLs.
* **QR Code Verification:** Decodes QR images inside chats using jsQR and verifies the hidden links.
* **Voice Deepfake/Scam Detection:** Extracts MFCC features using Meyda.js and runs them through a CNN-LSTM model.
* **Privacy First:** No data leaves the browser. Includes a base pipeline for Federated Learning (FL) using local storage.
* **Zero-Latency Whitelisting:** Uses the Tranco top 10K list for instant safe-link verification.

## 🛠️ Technologies Used
* JavaScript (ES6+), HTML5, CSS3
* **AI/ML:** TensorFlow.js
* **Audio Processing:** Meyda.js
* **QR Decoding:** jsQR
* Chrome Extension API (Manifest V3, Service Workers, Offscreen API)