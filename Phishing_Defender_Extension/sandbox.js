// sandbox.js - Secure environment for AI models and QR decoding

let urlModel, voiceModel, charDict;

// Training Locks (prevent simultaneous fit() calls)
let isTrainingUrl = false;
let isTrainingVoice = false;

// ======================================================================
// 1. Initialize AI Models securely & Prepare for Local Training
// ======================================================================
async function initAI() {
    try {
        const dictRes = await fetch('models/tfjs_model_url/char_dictionary.json');
        charDict = await dictRes.json();

        // Load and Compile URL Model for Federated Learning
        urlModel = await tf.loadLayersModel('models/tfjs_model_url/model.json');
        urlModel.compile({ optimizer: 'adam', loss: 'binaryCrossentropy', metrics: ['accuracy'] });

        // Load and Compile Voice Model for Federated Learning
        voiceModel = await tf.loadLayersModel('models/tfjs_model_voice/model.json');
        voiceModel.compile({ optimizer: 'adam', loss: 'binaryCrossentropy', metrics: ['accuracy'] });

        console.log("✅ [Sandbox] All AI Models Loaded & Compiled Successfully!");
    } catch (error) {
        console.error("❌ [Sandbox] Model Loading Error:", error);
    }
}
initAI();

// ======================================================================
// 2. Preprocess URL
// ======================================================================
function preprocessURL(url) {
    const wordIndex = charDict.word_index;
    const maxLen = charDict.optimal_maxlen;
    let sequence = [];

    for (let i = 0; i < url.length; i++) {
        let char = url[i].toLowerCase();
        sequence.push(wordIndex[char] ? wordIndex[char] : (wordIndex[''] || 1));
    }

    if (sequence.length > maxLen) sequence = sequence.slice(0, maxLen);
    else while (sequence.length < maxLen) sequence.push(0);

    return sequence;
}

// ======================================================================
// 3. Listen for tasks from offscreen.js
// ======================================================================
window.addEventListener('message', async (event) => {
    const msg = event.data;

    // --- A. Predict URL & Local Training ---
    if (msg.action === 'predict_url') {
        if (!urlModel) {
            event.source.postMessage({ id: msg.id, status: "LOADING", confidence: 0 }, event.origin);
            return;
        }

        const sequence = preprocessURL(msg.url);
        const tensor = tf.tensor2d([sequence]);
        const prediction = urlModel.predict(tensor).dataSync()[0];

        let isPhish = prediction > 0.65; // Threshold

        // Keyword checking (Rule-based overrides)
        const suspiciousWords = ["verify", "account", "update", "login", "secure", "support", "free", "claim", "promos", "win", "gift"];
        const urlLower = msg.url.toLowerCase();
        let keywordHits = 0;
        suspiciousWords.forEach(word => { if (urlLower.includes(word)) keywordHits++; });

        if (keywordHits >= 2) isPhish = true;

        // 🚀 FL UPDATE: Local Training on the new URL
        if (!isTrainingUrl) {
            isTrainingUrl = true;
            try {
                console.log("⏳ [Sandbox] Training URL model locally with new data...");
                const labelTensor = tf.tensor2d([[isPhish ? 1 : 0]]);

                // 🔥 FIXED: Added 'yieldEvery: never' to prevent Chrome offscreen freezing
                await urlModel.fit(tensor, labelTensor, { epochs: 1, batchSize: 1, yieldEvery: 'never' });

                console.log("✅ [Sandbox] URL Local Training Complete!");
                labelTensor.dispose();

                // Extract and send weights only after successful training
                extractAndSendWeights(urlModel, 'url', event.origin);
            } catch (e) {
                console.error("❌ [Sandbox] URL Local Training Error:", e);
            } finally {
                isTrainingUrl = false;
            }
        } else {
            console.warn("⚠️ [Sandbox] Skipped URL training, another fit() is running.");
        }

        tensor.dispose();

        event.source.postMessage({
            id: msg.id,
            status: isPhish ? "PHISHING" : "SAFE",
            confidence: isPhish ? 100 : (1 - prediction) * 100,
            sequence: sequence
        }, event.origin);
    }

    // --- B. Decode QR Code ---
    else if (msg.action === 'process_qr') {
        const img = new Image();
        img.onload = () => {
            const scanWithScale = (scaleFactor) => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width * scaleFactor;
                canvas.height = img.height * scaleFactor;
                ctx.fillStyle = "#FFFFFF";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                return jsQR(imgData.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
            };

            let code = scanWithScale(1.0) || scanWithScale(2.0) || scanWithScale(0.5);

            event.source.postMessage({
                id: msg.id,
                qrData: code ? code.data : null
            }, event.origin);
        };
        img.src = msg.imageUrl;
    }

    // --- C. Predict Voice Phishing & Local Training ---
    else if (msg.action === 'predict_voice') {
        if (!voiceModel) {
            console.error("❌ [Sandbox] Voice model is NULL! Cannot predict.");
            event.source.postMessage({ type: 'voice_result', status: "ERROR", confidence: 0 }, event.origin);
            return;
        }

        try {
            console.log(`🧠 [Sandbox] Analyzing Voice Data... Frames received: ${msg.features.length}`);

            let features = msg.features;
            const TARGET_FRAMES = 302;

            if (features.length > TARGET_FRAMES) {
                features = features.slice(0, TARGET_FRAMES);
            } else {
                while (features.length < TARGET_FRAMES) {
                    features.push(new Array(40).fill(0));
                }
            }

            console.log(`🧠 [Sandbox] Adjusted Frames to: ${features.length}`);

            let tensor = tf.tensor2d(features).expandDims(0).expandDims(-1);
            const prediction = voiceModel.predict(tensor).dataSync()[0];
            const isPhish = prediction > 0.5;

            console.log("🔊 [Sandbox] Voice Score: " + prediction.toFixed(4) + " | Result: " + (isPhish ? "PHISHING" : "SAFE"));

            // Send result immediately to UI
            event.source.postMessage({
                type: 'voice_result',
                status: isPhish ? "PHISHING" : "SAFE",
                confidence: isPhish ? prediction * 100 : (1 - prediction) * 100
            }, event.origin);

            // 🚀 FL UPDATE: Local Training
            if (!isTrainingVoice) {
                isTrainingVoice = true;
                try {
                    console.log("⏳ [Sandbox] Training Voice model locally with new data...");
                    const labelTensor = tf.tensor2d([[isPhish ? 1 : 0]]);

                    // 🔥 FIXED: Added 'yieldEvery: never' to prevent Chrome offscreen freezing
                    await voiceModel.fit(tensor, labelTensor, { epochs: 1, batchSize: 1, yieldEvery: 'never' });

                    console.log("✅ [Sandbox] Voice Local Training Complete!");
                    labelTensor.dispose();

                    // Extract and send weights only after successful training
                    extractAndSendWeights(voiceModel, 'voice', event.origin);
                } catch (e) {
                    console.error("❌ [Sandbox] Voice Local Training Error:", e);
                } finally {
                    isTrainingVoice = false;
                }
            } else {
                console.warn("⚠️ [Sandbox] Skipped Voice training, another fit() is running.");
            }

            tensor.dispose();

        } catch (error) {
            console.error("❌ [Sandbox] Voice Prediction Error:", error);
            event.source.postMessage({ type: 'voice_result', status: "ERROR", confidence: 0 }, event.origin);
        }
    }
});

// ======================================================================
// 4. Extract Weights for Federated Learning
// ======================================================================
async function extractAndSendWeights(model, modelType, origin) {
    if (!model) return;
    try {
        let weightsArray = [];
        let limitReached = false;

        for (let i = 0; i < model.layers.length; i++) {
            if (limitReached) break;

            let weights = model.layers[i].getWeights();
            for (let j = 0; j < weights.length; j++) {
                if (limitReached) break;

                let data = await weights[j].data();
                let dataArray = Array.from(data);

                for (let k = 0; k < dataArray.length; k++) {
                    if (weightsArray.length >= 500) {
                        limitReached = true;
                        break;
                    }
                    weightsArray.push(dataArray[k]);
                }
            }
        }

        console.log("📦 [Sandbox] Extracted " + weightsArray.length + " weights for " + modelType);

        window.parent.postMessage({
            type: 'federated_weights',
            modelType: modelType,
            weights: weightsArray
        }, origin);

    } catch (e) {
        console.error("❌ [Sandbox] Error extracting weights for " + modelType + ":", e);
    }
}