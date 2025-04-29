import mongoose from "mongoose";

// Submission type schema
const SubmissionType = {
    status: { type: String },
    _id: mongoose.Schema.Types.ObjectId,
    username: String,
    userId: mongoose.Schema.Types.ObjectId
}

// Test schema
const TestType = {
    input: { type: String, required: true },  // Link to the input file
    output: { type: String, required: true }  // Link to the output file
}

const problemSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    timeLimit: { type: Number, required: true },
    memoryLimit: { type: Number, required: true },
    submissions: [{ type: SubmissionType, ref: 'Submission' }],
    point: { type: Number, required: true },
    contestId: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Contest' }],
    testcase: { type: [TestType], default: [] }  // Array of test cases, each containing input and output file links
});

export default mongoose.models.Problem || mongoose.model("Problem", problemSchema);
