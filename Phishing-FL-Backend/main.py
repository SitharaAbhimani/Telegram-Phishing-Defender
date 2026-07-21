from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware 
from pydantic import BaseModel
from typing import List
import uvicorn
from motor.motor_asyncio import AsyncIOMotorClient
import certifi 
import numpy as np 

# Initialize FastAPI Application
app = FastAPI(title="Phishing Defender Federated Learning API")

# =====================================================================
# 🔥 CORS Configuration  
# =====================================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"],  
)

# MongoDB Connection Setup (Cloud)
MONGO_DETAILS = "mongodb+srv://sitharaabhimani2001_db_user:Sitha#2001@cluster0.vygxqrp.mongodb.net/?appName=Cluster0"

# 🔥 2. To slove SSL - add 'tlsCAFile=certifi.where()' 
client = AsyncIOMotorClient(MONGO_DETAILS, tlsCAFile=certifi.where())
database = client.phishing_fl_db

# Define MongoDB Collections
client_updates_col = database.get_collection("client_updates") 
global_model_col = database.get_collection("global_model")     

class WeightUpdate(BaseModel):
    client_id: str             
    model_type: str            
    weights: List[float]       
    data_samples_count: int    

@app.post("/api/weights/upload")
async def upload_weights(update: WeightUpdate):
    try:
        update_dict = update.dict()
        await client_updates_col.insert_one(update_dict)
        print(f"✅ Received {update.model_type} weights from client: {update.client_id}")
        return {"message": "Weights received securely.", "status": "success"}
    except Exception as e:
        
        print(f"❌ Database Error: {e}") 
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/weights/global/{model_type}")
async def get_global_weights(model_type: str):
    global_weights = await global_model_col.find_one(
        {"model_type": model_type}, 
        sort=[("_id", -1)] 
    )
    if global_weights:
        global_weights["_id"] = str(global_weights["_id"]) 
        return global_weights
    return {"message": "No global model found yet", "weights": []}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


# =====================================================================
# 3. Federated Averaging (FedAvg) - Build Global Model (POST)
# =====================================================================
@app.post("/api/weights/aggregate/{model_type}")
async def aggregate_weights(model_type: str):
    try:
        # 1.model_type (ex: "url" or "voice") all weights are get from Database 
        cursor = client_updates_col.find({"model_type": model_type})
        updates = await cursor.to_list(length=1000)

        if not updates:
            return {"message": f"No client updates found for {model_type}.", "status": "info"}

        # 2. calculate (n_total) 
        total_samples = sum(update["data_samples_count"] for update in updates)
        
        # 3. Create an empty array to collect the sum of the weights.
        first_weights = np.array(updates[0]["weights"])
        aggregated_weights = np.zeros_like(first_weights, dtype=float)

        # 4. calculate FedAvg  (according to formula)
        for update in updates:
            client_weights = np.array(update["weights"])
            client_samples = update["data_samples_count"]
            # Data is collected by weighting according to size.
            aggregated_weights += client_weights * (client_samples / total_samples)

        # 5. The newly created Global Model is saved to the database.
        new_global_model = {
            "model_type": model_type,
            "weights": aggregated_weights.tolist(),
            "aggregated_clients_count": len(updates),
            "total_data_samples": total_samples
        }
        await global_model_col.insert_one(new_global_model)

        # 6. Deletes old client data that has been collected (allows for the next round)
        await client_updates_col.delete_many({"model_type": model_type})

        return {
            "message": "Federated Averaging completed successfully!", 
            "status": "success",
            "clients_aggregated": len(updates)
        }

    except Exception as e:
        print(f"❌ Aggregation Error: {e}") 
        raise HTTPException(status_code=500, detail=str(e))    