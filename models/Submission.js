// File: src/models/Submission.js
import mongoose from 'mongoose';

const submissionSchema = new mongoose.Schema({
    code: { type: String, required: true },         // link tới file code trên Cloudinary
    status: { type: String, default: "not_run" },       // 'accepted', 'partial', 'compile_error', v.v.
    score: { type: Number, default: 0 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
    problemName: { type: String, required: true },
    language: { type: String, default: "c++" },
    msg: { type: String },
    submittedAt: { type: Date, default: Date.now },

    // ← Thêm đây:
    testStatuses: {
        type: [String],      // ví dụ: ['accepted','wrong_answer','accepted']
        default: []
    }
});

export default mongoose.models.Submission || mongoose.model('Submission', submissionSchema);
