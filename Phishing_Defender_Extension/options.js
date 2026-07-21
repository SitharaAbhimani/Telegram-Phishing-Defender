document.getElementById('allow-mic-btn').addEventListener('click', async () => {
    try {
        // get access from browser
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Once permission is granted, the mic will be turned off again (we just need permission).
        stream.getTracks().forEach(track => track.stop());

        document.getElementById('status-text').innerText = "✅ Success! Microphone permission has been granted. You can now close this page and use Telegram..";
    } catch (err) {
        document.getElementById('status-text').innerText = "❌ Permission denied. Please grant 'Allow' permission.";
        document.getElementById('status-text').style.color = "#f44336";
        console.error("Mic error:", err);
    }
});