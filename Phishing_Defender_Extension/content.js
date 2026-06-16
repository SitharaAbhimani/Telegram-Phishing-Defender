// content.js - Runs inside Telegram Web

console.log("🛡️ AI Phishing Defender active on Telegram Web!");

// 1. Function to find and scan URLs in the chat
function scanTelegramLinks() {
    const links = document.querySelectorAll('a[href^="http"]:not(.ai-scanned)');

    links.forEach(link => {
        link.classList.add('ai-scanned');


        if (!link.innerText.trim()) return;

        // 2. Telegram web has specific containers for web page previews.
        if (link.closest('.web-page') || link.closest('.WebPage') || link.closest('.MessageMedia') || link.closest('.message-media') || link.closest('.link-preview')) {
            return;
        }

        const url = link.href;

        // Create a loading tag next to the link
        const tag = document.createElement('span');
        tag.className = 'ai-defender-tag ai-loading';
        tag.innerText = 'AI Scanning...';
        link.parentNode.insertBefore(tag, link.nextSibling);

        // Send URL to our AI model in background.js
        chrome.runtime.sendMessage({ action: "check_url", url: url }, (response) => {
            if (chrome.runtime.lastError || !response) {
                tag.style.display = 'none';
                return;
            }

            // Update the tag based on AI response
            if (response.status === "SAFE") {
                tag.className = 'ai-defender-tag ai-safe';
                tag.innerText = `✅ Safe`;
            } else if (response.status === "PHISHING") {
                tag.className = 'ai-defender-tag ai-phish';
                tag.innerText = `🚨 Phishing`;
                link.style.color = '#e74c3c';
                link.style.textDecoration = 'line-through';
            } else if (response.status === "LOADING") {
                tag.className = 'ai-defender-tag ai-loading';
                tag.innerText = `⏳ Loading...`;
                setTimeout(() => {
                    tag.remove();
                    link.classList.remove('ai-scanned');
                }, 2000);
            }
        });
    });
}

// 2. Use a MutationObserver to constantly watch for NEW messages/links appearing
const observer = new MutationObserver((mutations) => {
    // Throttle the scanning slightly to not lag Telegram
    clearTimeout(window.scanTimeout);
    window.scanTimeout = setTimeout(scanTelegramLinks, 500);
});

// Start observing the whole body for new chat messages
observer.observe(document.body, { childList: true, subtree: true });

// Run once immediately
scanTelegramLinks();


// 3. VOICE MESSAGE SCANNER IN TELEGRAM
// ======================================================================
function scanTelegramVoiceMessages() {
    // Telegram web uses specific classes for voice messages. 
    // We look for audio elements or voice message containers.
    // 'audio' tag or divs with 'voice'/'audio' in their class name.
    const voiceContainers = document.querySelectorAll('.audio, .voice-message, audio');

    voiceContainers.forEach(container => {
        // Prevent adding multiple buttons to the same message
        if (container.classList.contains('ai-voice-scanned')) return;
        container.classList.add('ai-voice-scanned');

        // Create our Custom AI Scan Button
        const scanBtn = document.createElement('button');
        scanBtn.innerText = '🎤 AI Scan';
        scanBtn.className = 'ai-defender-tag';
        scanBtn.style.backgroundColor = '#e67e22';
        scanBtn.style.border = 'none';
        scanBtn.style.cursor = 'pointer';
        scanBtn.style.marginTop = '5px';

        // Insert the button near the voice message
        container.parentNode.insertBefore(scanBtn, container.nextSibling);

        // When the user clicks "AI Scan"
        scanBtn.addEventListener('click', (e) => {
            e.preventDefault();
            scanBtn.innerText = 'Listening (7s)...';
            scanBtn.style.backgroundColor = '#95a5a6';

            // Tell background.js to start the hidden mic recording
            chrome.runtime.sendMessage({ action: "start_voice_scan" });
        });
    });
}

// Add voice scanning to our existing MutationObserver
const originalScan = window.scanTimeout;
const observerVoice = new MutationObserver((mutations) => {
    clearTimeout(window.scanTimeoutVoice);
    window.scanTimeoutVoice = setTimeout(() => {
        scanTelegramLinks();         // From previous step
        scanTelegramVoiceMessages(); // New Voice step
    }, 500);
});

// Start observing
observerVoice.observe(document.body, { childList: true, subtree: true });
scanTelegramVoiceMessages();

// ======================================================================
// 4. LISTEN FOR VOICE RESULTS FROM BACKGROUND
// ======================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "voice_result_ready") {
        // Find the button that is currently "Listening" to update it
        // (In a perfect app, we'd use specific IDs, but this works for demonstration)
        const activeBtns = document.querySelectorAll('.ai-defender-tag');
        activeBtns.forEach(btn => {
            if (btn.innerText.includes('Listening')) {
                if (request.status === "SAFE") {
                    btn.innerText = `✅ Safe Voice (${request.confidence.toFixed(1)}%)`;
                    btn.style.backgroundColor = '#27ae60';
                } else if (request.status === "PHISHING") {
                    btn.innerText = `🚨 PHISHING SCAM (${request.confidence.toFixed(1)}%)`;
                    btn.style.backgroundColor = '#e74c3c';
                }
            }
        });
    }
});

// ======================================================================
// 5. QR CODE IMAGE SCANNER IN TELEGRAM
// ======================================================================
function scanTelegramImagesForQR() {
    // Find images in the chat
    const images = document.querySelectorAll('img:not(.ai-qr-scanned)');

    images.forEach(img => {
        img.classList.add('ai-qr-scanned');

        // When an image loads, send its source to background.js to decode
        img.onload = () => {
            chrome.runtime.sendMessage({
                action: "decode_and_check_qr",
                imageUrl: img.src
            }, (response) => {
                if (response && response.status === "PHISHING") {
                    img.style.border = "5px solid #e74c3c"; // Red border for danger
                    img.style.filter = "blur(5px)"; // Blur the malicious QR

                    const warning = document.createElement('div');
                    warning.className = 'ai-defender-tag ai-phish';
                    warning.innerText = `🚨 PHISHING QR DETECTED (${response.confidence.toFixed(1)}%)`;
                    img.parentNode.insertBefore(warning, img);
                }
            });
        };
    });
}

// Update the observer to run this too
const finalObserver = new MutationObserver((mutations) => {
    clearTimeout(window.scanTimeoutFull);
    window.scanTimeoutFull = setTimeout(() => {
        scanTelegramLinks();
        scanTelegramVoiceMessages();
        scanTelegramImagesForQR(); // <--- Added the QR scanner
    }, 500);
});
finalObserver.observe(document.body, { childList: true, subtree: true });