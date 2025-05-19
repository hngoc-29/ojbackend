import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import dbConnect from '../lib/mongoose.js';
import Problem from '../models/Problem.js';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Cấu hình Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

// Tạo tmp folder nếu chưa tồn tại
const tmpDir = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

// Multer lưu file vào tmp/
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}__${file.originalname}`)
});
const upload = multer({
    storage,
    limits: { fileSize: 300 * 1024 * 1024 }
});

// Middleware xác thực JWT
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Thiếu token' });
    }
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Token không hợp lệ' });
    }
}

// Hàm upload file từ file hệ thống qua stream
function uploadFile(filePath, publicId, folder) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                public_id: publicId,
                resource_type: 'raw',
                use_filename: true,
                unique_filename: false,
            },
            (err, result) => {
                if (err) return reject(err);
                resolve(result);
            }
        );

        fs.createReadStream(filePath).pipe(stream);
    });
}

// Route upload testcase
router.post('/:id/testcase', authMiddleware, upload.any(), async (req, res) => {
    try {
        await dbConnect();
        const { id } = req.params;
        const problem = await Problem.findById(id);
        if (!problem) {
            return res.status(404).json({ success: false, message: 'Problem không tồn tại' });
        }

        // Gom input/output thành cặp
        const map = {};
        for (const file of req.files) {
            const m = file.fieldname.match(/^(input|output)(.*)$/);
            if (!m) continue;
            const [, type, rawKey] = m;
            const key = rawKey || 'default';
            map[key] = map[key] || { key };
            map[key][type] = file;
        }

        const pairs = Object.values(map).filter(p => p.input && p.output);
        if (pairs.length === 0) {
            return res.status(400).json({ success: false, message: 'Không tìm thấy cặp input/output hợp lệ' });
        }

        const slug = problem.title
            ? problem.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '-')
            : `problem-${id}`;

        const results = [];

        for (const p of pairs) {
            const inputRes = await uploadFile(p.input.path, `${p.key}_in`, `testcase/${slug}`);
            const outputRes = await uploadFile(p.output.path, `${p.key}_out`, `testcase/${slug}`);

            const inputUrl = inputRes.secure_url || inputRes.url;
            const outputUrl = outputRes.secure_url || outputRes.url;

            if (!inputUrl || !outputUrl) {
                throw new Error(`Không lấy được URL từ Cloudinary`);
            }

            // Xoá file tmp
            fs.unlinkSync(p.input.path);
            fs.unlinkSync(p.output.path);

            results.push({ input: inputUrl, output: outputUrl });
        }

        problem.testcase.push(...results);
        await problem.save();

        return res.json({ success: true, message: 'Thêm testcase thành công', testcases: results });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
