import express from 'express';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import cors from 'cors';
import submissionRoute from './routes/submission.js';
import dbConnect from './lib/mongoose.js';
import 'dotenv/config';

const app = express();
const httpServer = createServer(app);

// Dùng env BASE_URL để cấu hình CORS
const allowedOrigin = process.env.BASE_URL;
const corsOptions = {
    origin: allowedOrigin,
    credentials: true
};

// Express CORS
app.use(cors(corsOptions));

// Socket.IO CORS
const io = new IOServer(httpServer, {
    cors: { origin: allowedOrigin, credentials: true }
});

// Make io available trong các route
app.set('io', io);

// Kết nối database
await dbConnect();

// Middleware JSON
app.use(express.json());

// Routes
app.use('/submissions', submissionRoute);
app.all('/start', (req, res) => {
    res.json({
        success: true
    })
});

// Khởi chạy server
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
    console.log(`Submission service chạy trên port ${PORT}`);
});
