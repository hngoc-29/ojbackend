import express from 'express';
import mongoose from 'mongoose';
import fetch from 'node-fetch';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { spawnSync } from 'child_process';
import Submission from '../models/Submission.js';
import Problem from '../models/Problem.js';
import User from '../models/User.js';
import Contest from '../models/Contest.js';

const router = express.Router();

// Cập nhật điểm cuộc thi với atomic update để tránh VersionError
const updateUserScoreInContests = async (userId, problemId, point) => {
    // Tìm contest chứa user và problem
    const contest = await Contest.findOne({
        'user._id': userId,
        problems: problemId
    }).lean();
    if (!contest) return;

    // Xác định index của problem và user
    const problemIndex = contest.problems.findIndex(p => p.toString() === problemId.toString());
    const userIndex = contest.user.findIndex(u => u._id.toString() === userId.toString());
    if (problemIndex < 0 || userIndex < 0) return;

    // Lấy mảng điểm hiện tại
    const currentScores = Array.isArray(contest.user[userIndex].score)
        ? contest.user[userIndex].score
        : [];
    // Tính điểm cũ và mới
    const oldScore = currentScores[problemIndex] || 0;
    const newScore = Math.max(oldScore, point);

    if (currentScores.length <= problemIndex) {
        // Nếu mảng chưa đủ dài, pad zeros và cập nhật cả mảng
        const padding = Array(problemIndex + 1 - currentScores.length).fill(0);
        const newScores = [...currentScores, ...padding];
        newScores[problemIndex] = newScore;
        await Contest.updateOne(
            { _id: contest._id },
            { $set: { [`user.${userIndex}.score`]: newScores } }
        );
    } else {
        // Nếu mảng đã đủ dài, chỉ cập nhật phần tử
        await Contest.updateOne(
            { _id: contest._id },
            { $set: { [`user.${userIndex}.score.${problemIndex}`]: newScore } }
        );
    }
};

router.post('/:id/run', async (req, res) => {
    const io = req.app.get('io');
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        }

        // Kiểm tra submission và cập nhật status atomically
        const submission = await Submission.findOneAndUpdate(
            { _id: id, status: 'not_run' },
            { $set: { status: 'running', testStatuses: [] } },
            { new: true }
        );
        if (!submission) {
            const existing = await Submission.findById(id);
            if (!existing) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy bài nộp' });
            }
            return res.status(200).json({
                success: false,
                done: true,
                msg: existing.msg,
                status: existing.status,
                score: existing.score,
                testStatuses: existing.testStatuses
            });
        }

        res.status(200).json({ success: true, message: 'Bắt đầu chạy tests...' });

        const problem = await Problem.findById(submission.problemId);
        if (!problem) {
            io.emit(`submission_${id}`, { error: 'Không tìm thấy bài toán' });
            return;
        }

        // Tải code
        const codeRes = await fetch(submission.code);
        const codeBuf = Buffer.from(await codeRes.arrayBuffer());

        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subm-'));
        const srcPath = path.join(tmpDir, 'Main.cpp');
        const exePath = path.join(tmpDir, 'Main');
        await fs.writeFile(srcPath, codeBuf);

        // Compile
        const compile = spawnSync('g++', ['-O2', '-std=c++17', srcPath, '-o', exePath]);
        if (compile.status !== 0) {
            const errMsg = compile.stderr?.toString() || 'Lỗi biên dịch';
            await Submission.findByIdAndUpdate(id, {
                status: 'compile_error',
                msg: errMsg,
                score: 0,
                testStatuses: ['compile_error']
            });
            io.emit(`submission_${id}`, { status: 'compile_error', message: errMsg, done: true });
            return;
        }

        // Chạy các test case
        const total = problem.testcase.length;
        let passed = 0;
        const statuses = [];

        for (let i = 0; i < total; i++) {
            const tc = problem.testcase[i];
            const inRes = await fetch(tc.input);
            const inputBuf = Buffer.from(await inRes.arrayBuffer());

            const start = Date.now();
            const run = spawnSync(exePath, {
                input: inputBuf,
                timeout: problem.timeLimit,
                killSignal: 'SIGKILL',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const end = Date.now();
            const time = ((end - start) / 1000).toFixed(3);

            let status;
            let displayTime = Number(time);
            if (run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGKILL') {
                status = 'timeout';
                displayTime = (problem.timeLimit / 1000) + 0.001; // Đảm bảo lớn hơn timeLimit
                // Không cần xử lý output nữa, dừng test tại đây
            } else if (run.status !== 0) {
                status = 'runtime_error';
            } else {
                const out = run.stdout.toString().replace(/\r\n/g, '\n').trimEnd();
                const expectedRaw = await (await fetch(tc.output)).text();
                const expected = expectedRaw.replace(/\r\n/g, '\n').trimEnd();
                status = out === expected ? 'accepted' : 'wrong_answer';
                if (status === 'accepted') passed++;
            }

            statuses.push({ status, time: displayTime });
            io.emit(`submission_${id}`, { index: i, status, time: displayTime, memory: null });
        }

        // Tính điểm và cập nhật
        const score = Math.round((passed / total) * problem.point * 100) / 100;
        const finalStatus = passed === total ? 'accepted' : `${passed}/${total}`;

        await Submission.findByIdAndUpdate(id, {
            status: finalStatus,
            score,
            testStatuses: statuses
        });

        await updateUserScoreInContests(submission.userId, problem._id, score);

        io.emit(`submission_${id}`, { done: true, score, status: finalStatus });
    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: err.message, error: true });
        }
    }
})

export default router;
