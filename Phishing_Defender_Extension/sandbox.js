let urlModel, voiceModel, charDict;

// Load models securely inside the Sandbox
async function initAI() {
    try {
        const dictRes = await fetch('models/char_dictionary.json');
        charDict = await dictRes.json();
        urlModel = await tf.loadLayersModel('models/tfjs_model_url/model.json');
        voiceModel = await tf.loadLayersModel('models/tfjs_model_voice/model.json');
        console.log("✅ Sandbox AI Models Loaded Successfully!");
    } catch (error) { console.error("Sandbox Error:", error); }
}
initAI();

function preprocessURL(url) {
    const wordIndex = charDict.word_index;
    const maxLen = charDict.optimal_maxlen;
    let sequence = [];
    for (let i = 0; i < url.length; i++) {
        let char = url[i].toLowerCase();
        sequence.push(wordIndex[char] ? wordIndex[char] : (wordIndex['<OOV>'] || 1));
    }
    if (sequence.length > maxLen) sequence = sequence.slice(0, maxLen);
    else while (sequence.length < maxLen) sequence.push(0);
    return sequence;
}

// Listen for tasks
window.addEventListener('message', (event) => {
    const msg = event.data;

    // 1. Predict URL
    if (msg.action === 'predict_url') {
        
        if(!urlModel) {
            event.source.postMessage({ id: msg.id, status: "LOADING", confidence: 0 }, event.origin);
            return;
        }
        
        const sequence = preprocessURL(msg.url);
        const tensor = tf.tensor2d([sequence]);
        const prediction = urlModel.predict(tensor).dataSync()[0];
        const isPhish = prediction > 0.5;
        
        event.source.postMessage({
            id: msg.id,
            status: isPhish ? "PHISHING" : "SAFE",
            confidence: isPhish ? prediction * 100 : (1 - prediction) * 100
        }, event.origin);
    }
    
    // 2. Decode QR
    else if (msg.action === 'process_qr') {
        const img = new Image();
        img.src = msg.imageUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imgData.data, imgData.width, imgData.height);
            event.source.postMessage({ id: msg.id, qrData: code ? code.data : null }, event.origin);
        };
    }
    
    // 3. Predict Voice
    else if (msg.action === 'predict_voice') {
        if(!voiceModel) return;
        let tensor = tf.tensor2d(msg.features).expandDims(0).expandDims(-1);
        const prediction = voiceModel.predict(tensor).dataSync()[0];
        const isPhish = prediction > 0.5;
        
        event.source.postMessage({
            type: 'voice_result', // Special tag for voice
            status: isPhish ? "PHISHING" : "SAFE",
            confidence: isPhish ? prediction * 100 : (1 - prediction) * 100
        }, event.origin);
    }
});