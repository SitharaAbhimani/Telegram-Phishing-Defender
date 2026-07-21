// content.js - Runs inside Telegram Web

console.log("🛡️ AI Phishing Defender active on Telegram Web!");

// ======================================================================
// 1. URL SCANNER IN TELEGRAM
// ======================================================================
function scanTelegramLinks() {
    const links = document.querySelectorAll('a[href^="http"]:not(.ai-scanned)');

    links.forEach(link => {
        link.classList.add('ai-scanned');

        if (!link.innerText.trim()) return;

        if (link.querySelector('img') ||
            link.querySelector('div') ||
            link.closest('.WebPage') ||
            link.closest('.web-page') ||
            link.closest('.LinkPreview') ||
            link.closest('.link-preview-wrapper') ||
            link.closest('.message-media') ||
            link.closest('.is-webpage')) {
            return;
        }

        const url = link.href;
        const tag = document.createElement('span');
        tag.className = 'ai-defender-tag ai-loading';
        tag.innerText = '⏳ Loading...';
        link.parentNode.insertBefore(tag, link.nextSibling);

        chrome.runtime.sendMessage({ action: "check_url", url: url }, (response) => {
            if (chrome.runtime.lastError || !response) {
                tag.style.display = 'none';
                return;
            }

            if (response.status === "SAFE") {
                tag.className = 'ai-defender-tag ai-safe';
                tag.innerText = `✅ Safe`;
            } else if (response.status === "PHISHING") {
                tag.className = 'ai-defender-tag ai-phish';
                tag.innerText = `🚨 Phishing`;
            } else if (response.status === "LOADING") {
                tag.className = 'ai-defender-tag ai-loading';
                tag.innerText = `⏳ Loading...`;
                setTimeout(() => {
                    tag.remove();
                    link.classList.remove('ai-scanned');
                }, 2000);
            } else {
                tag.style.display = 'none';
            }
        });
    });
}

// ======================================================================
// 2. VOICE MESSAGE SCANNER IN TELEGRAM
// ======================================================================
function scanTelegramVoiceMessages() {
    // 🔥 Added '.media-document', '.document', '.File' to catch audio files sent as documents
    const voiceContainers = document.querySelectorAll('.audio, .voice-message, audio, .document-audio, .message-document, .media-audio, .media-document, .document, .File');

    voiceContainers.forEach(container => {
        if (container.classList.contains('ai-voice-scanned')) return;
        container.classList.add('ai-voice-scanned');

        const scanBtn = document.createElement('button');
        scanBtn.innerText = '🎤 AI Scan';
        scanBtn.className = 'ai-defender-tag';
        scanBtn.style.backgroundColor = '#e67e22';
        scanBtn.style.border = 'none';
        scanBtn.style.cursor = 'pointer';
        scanBtn.style.marginTop = '5px';
        scanBtn.style.padding = '5px 10px';
        scanBtn.style.borderRadius = '5px';
        scanBtn.style.color = 'white';
        scanBtn.style.fontWeight = 'bold';
        scanBtn.style.display = 'block'; // Ensure it goes to a new line

        if (container.parentNode) {
            container.parentNode.insertBefore(scanBtn, container.nextSibling);
        }

        scanBtn.addEventListener('click', (e) => {
            e.preventDefault();
            scanBtn.innerText = 'Listening... Play Audio! (7s)';
            scanBtn.style.backgroundColor = '#95a5a6';

            chrome.runtime.sendMessage({ action: "start_voice_scan" });
        });
    });
}

// Listen for the final voice analysis results
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "voice_result_ready") {
        const activeBtns = document.querySelectorAll('.ai-defender-tag');
        activeBtns.forEach(btn => {
            if (btn.innerText.includes('Listening')) {
                if (request.status === "SAFE") {
                    btn.innerText = `✅ Safe Voice`;
                    btn.style.backgroundColor = '#27ae60';
                } else if (request.status === "PHISHING") {
                    btn.innerText = `🚨 Phishing Scam!`;
                    btn.style.backgroundColor = '#e74c3c';
                }
            }
        });
    }
});

// ======================================================================
// 3. QR CODE IMAGE SCANNER (Final UI with Decoded URL Display)
// ======================================================================
function scanTelegramImagesForQR() {
    const images = document.querySelectorAll('img:not(.ai-qr-scanned)');

    images.forEach(img => {
        if (img.width < 50) return;
        img.classList.add('ai-qr-scanned');

        const attemptScan = async () => {
            try {
                const response = await fetch(img.src);
                const blob = await response.blob();
                const base64Data = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });

                chrome.runtime.sendMessage({ action: "decode_and_check_qr", imageUrl: base64Data }, (res) => {
                    if (chrome.runtime.lastError || !res || res.status === "NO_QR") return;

                    const tag = document.createElement('div');
                    tag.style.position = 'absolute';
                    tag.style.top = '10px';
                    tag.style.left = '10px';
                    tag.style.zIndex = '2147483647';
                    tag.style.padding = '8px 15px';
                    tag.style.borderRadius = '8px';
                    tag.style.fontWeight = 'bold';
                    tag.style.color = 'white';
                    tag.style.boxShadow = '0px 4px 10px rgba(0,0,0,0.6)';
                    tag.style.pointerEvents = 'none';
                    tag.style.fontSize = '14px';
                    tag.style.fontFamily = 'Arial, sans-serif';
                    tag.style.whiteSpace = 'nowrap';
                    tag.style.lineHeight = 'normal';
                    tag.className = 'ai-defender-qr-tag';

                    const parent = img.parentElement;
                    if (parent) {
                        parent.style.position = 'relative';

                        // Format the extracted URL to show inside the tag
                        let displayUrl = res.url ? res.url : "Scanned Link";
                        if (displayUrl.length > 30) displayUrl = displayUrl.substring(0, 30) + '...';

                        if (res.status === "PHISHING") {
                            img.style.border = "5px solid #e74c3c";
                            img.style.filter = "blur(5px)";
                            tag.style.backgroundColor = '#e74c3c';
                            tag.innerHTML = `🚨 Phishing QR!<br><span style="font-size:11px; font-weight:normal; opacity:0.9;">${displayUrl}</span>`;
                        } else if (res.status === "SAFE") {
                            img.style.border = "5px solid #27ae60";
                            tag.style.backgroundColor = '#27ae60';
                            tag.innerHTML = `✅ Safe QR<br><span style="font-size:11px; font-weight:normal; opacity:0.9;">${displayUrl}</span>`;
                        }

                        parent.appendChild(tag);
                    }
                });
            } catch (e) {
                console.error("❌ [Content] Extraction Error:", e);
            }
        };

        if (img.complete && img.naturalHeight !== 0) {
            setTimeout(attemptScan, 1000);
        } else {
            img.onload = () => setTimeout(attemptScan, 1000);
        }
    });
}

// ======================================================================
// 4. MASTER MUTATION OBSERVER
// ======================================================================
const masterObserver = new MutationObserver((mutations) => {
    clearTimeout(window.masterScanTimeout);
    window.masterScanTimeout = setTimeout(() => {
        scanTelegramLinks();
        scanTelegramVoiceMessages();
        scanTelegramImagesForQR();
    }, 1000);
});

masterObserver.observe(document.body, { childList: true, subtree: true });

setTimeout(() => {
    scanTelegramLinks();
    scanTelegramVoiceMessages();
    scanTelegramImagesForQR();
}, 1500);