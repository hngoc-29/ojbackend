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

    // Chuẩn bị ops update
    const updateOps = {};
    // Nếu mảng chưa đủ dài, pad zeros
    if (currentScores.length <= problemIndex) {
        const padding = Array(problemIndex + 1 - currentScores.length).fill(0);
        updateOps[`user.${userIndex}.score`] = [...currentScores, ...padding];
    }
    // Cập nhật phần tử cụ thể
    updateOps[`user.${userIndex}.score.${problemIndex}`] = newScore;

    // Thực hiện atomic update
    await Contest.updateOne({ _id: contest._id }, { $set: updateOps });
};

router.post('/:id/run', async (req, res) => {
    const io = req.app.get('io');
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        }

        const submission = await Submission.findById(id);
        if (!submission) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài nộp' });
        }

        if (submission.status !== 'not_run') {
            return res.status(200).json({
                success: false,
                done: true,
                msg: submission.msg,
                status: submission.status,
                score: submission.score,
                testStatuses: submission.testStatuses
            });
        }

        res.status(200).json({ success: true, message: 'Bắt đầu chạy tests...' });

        const problem = await Problem.findById(submission.problemId);
        if (!problem) {
            io.emit(`submission_${id}`, { error: 'Không tìm thấy bài toán' });
            return;
        }

        await Submission.findByIdAndUpdate(id, { status: 'running', testStatuses: [] });

        // Lấy code, tạo file tạm và compile 1 lần
        const codeRes = await fetch(submission.code);
        const codeBuf = Buffer.from(await codeRes.arrayBuffer());

        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subm-'));
        const srcPath = path.join(tmpDir, 'Main.cpp');
        const exePath = path.join(tmpDir, 'Main');
        await fs.writeFile(srcPath, codeBuf);

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

        const total = problem.testcase.length;
        let passed = 0;
        const statuses = [];
        for (let i = 0; i < total; i++) {
            const tc = problem.testcase[i];
            const inRes = await fetch(tc.input);
            const inputBuf = Buffer.from(await inRes.arrayBuffer());

            const run = spawnSync(exePath, {
                input: inputBuf,
                timeout: problem.timeLimit,
                killSignal: 'SIGKILL',
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let status;
            if (run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGKILL') {
                status = 'timeout';
            } else if (run.status !== 0) {
                status = 'runtime_error';
            } else {
                const out = run.stdout.toString().replace(/\r\n/g, '\n').trimEnd();
                const expectedRaw = await (await fetch(tc.output)).text();
                const expected = expectedRaw.replace(/\r\n/g, '\n').trimEnd();
                status = out === expected ? 'accepted' : 'wrong_answer';

                if (status === 'accepted') passed++;
            }

            statuses.push(status);
            await io.emit(`submission_${id}`, { index: i, status, time: null, memory: null });
        }

        const score = Math.round((passed / total) * problem.point * 100) / 100;

        const finalStatus = passed === total ? 'accepted' : `${passed}/${total}`;

        await Submission.findByIdAndUpdate(id, { status: finalStatus, score, testStatuses: statuses });
        await updateUserScoreInContests(submission.userId, problem._id, score);

        io.emit(`submission_${id}`, { done: true, score, status: finalStatus });
    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: err.message });
        }
    }
});

export default router;
