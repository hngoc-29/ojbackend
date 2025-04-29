import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    _id: { type: String, required: true }, // userId
    username: { type: String, required: true },
    score: {
        type: [Number], // Mỗi phần tử là điểm của 1 bài
        default: [],
    },
}, { _id: false }); // không tạo _id riêng cho mỗi user trong mảng

const contestSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String },
    problems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Problem', defalut: [] }],
    user: {
        type: [userSchema],
        default: [],
    },
});

export default mongoose.models.Contest || mongoose.model("Contest", contestSchema);
