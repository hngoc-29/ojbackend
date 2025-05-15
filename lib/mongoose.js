// File: src/lib/mongoose.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

let isConnected = false;

export default async function dbConnect() {
    if (isConnected) return;
    if (!process.env.MONGODB_URI) {
        throw new Error('Please define the MONGODB_URI environment variable');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
    console.log('MongoDB connected');

    // Drop unique index 'path_1' on contests collection if exists
    try {
        const coll = mongoose.connection.db.collection('contests');
        const indexList = await coll.indexes();
        const hasPathIndex = indexList.some(idx => idx.name === 'path_1');
        if (hasPathIndex) {
            await coll.dropIndex('path_1');
            console.log('Dropped index path_1 on contests collection');
        } else {
            console.log('Index path_1 not found on contests, skipping drop');
        }
    } catch (err) {
        console.error('Error dropping index path_1:', err);
    }
}
