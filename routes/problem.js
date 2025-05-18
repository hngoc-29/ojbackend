import express from 'express';
import dbConnect from '../lib/mongoose.js';
import Problem from '../models/Problem.js';
import cloudinary from '../lib/cloudinary.js';
import multer from 'multer';
import jwt from 'jsonwebtoken';

const router = express.Router();
const upload = multer({
    limits: {
        fileSize: 300 * 1024 * 1024 // 20MB
    }
});

// Middleware xác thực Bearer token
function authMiddleware(req, res, next) {
    // Lấy token từ header Authorization: Bearer <token>
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Thiếu token xác thực' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Token không hợp lệ' });
    }
}

// Hàm upload buffer lên Cloudinary
function uploadBuffer(buffer, folder, publicId) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, resource_type: 'raw', public_id: publicId },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(buffer);
    });
}

// Hàm chuyển tên sang slug
function toSlug(str) {
    return str
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase();
}

// POST thêm testcase (có xác thực)
router.post(
    '/:id/testcase',
    authMiddleware,
    upload.any(),
    async (req, res) => {
        try {
            await dbConnect();
            const { id } = req.params;
            // req.files là mảng [{fieldname, buffer, ...}]
            const filesArr = req.files || [];
            const problem = await Problem.findById(id);
            if (!problem) {
                return res.status(404).json({ success: false, message: 'Problem không tồn tại' });
            }
            const slug = toSlug(problem.title || problem.name || `problem-${id}`);

            // Gom input/output theo index
            const inputs = [];
            const outputs = [];
            filesArr.forEach(file => {
                if (file.fieldname.startsWith('input')) {
                    const idx = parseInt(file.fieldname.replace('input', ''));
                    inputs[idx] = file;
                }
                if (file.fieldname.startsWith('output')) {
                    const idx = parseInt(file.fieldname.replace('output', ''));
                    outputs[idx] = file;
                }
            });

            // Lọc undefined (nếu có lỗ hổng index)
            const filteredInputs = inputs.filter(Boolean);
            const filteredOutputs = outputs.filter(Boolean);

            if (
                !filteredInputs.length ||
                !filteredOutputs.length ||
                filteredInputs.length !== filteredOutputs.length
            ) {
                return res.status(400).json({ success: false, message: 'Thiếu file input hoặc output hoặc số lượng không khớp' });
            }

            const uploadPromises = filteredInputs.map(async (inputFile, idx) => {
                const outputFile = filteredOutputs[idx];
                if (!inputFile || !outputFile) return null;
                const inputBuffer = inputFile.buffer;
                const outputBuffer = outputFile.buffer;
                const timestamp = Date.now();
                const [inputRes, outputRes] = await Promise.all([
                    uploadBuffer(inputBuffer, `testcase/${slug}`, `input_${idx}${timestamp}${idx}.txt`),
                    uploadBuffer(outputBuffer, `testcase/${slug}`, `output_${idx}${timestamp}${idx}.txt`),
                ]);
                return {
                    input: inputRes.secure_url,
                    output: outputRes.secure_url,
                };
            });

            const newTestcases = (await Promise.all(uploadPromises)).filter(Boolean);
            problem.testcase.push(...newTestcases);
            await problem.save();

            res.json({ success: true, message: 'Thêm testcase thành công', testcases: newTestcases });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message, error: true });
        }
    }
);

// Nếu muốn bảo vệ các route khác, thêm authMiddleware vào các route đó:
// router.put('/:id/testcase', authMiddleware, upload.any(), async (req, res) => { ... });
// router.delete('/:id/testcase', authMiddleware, async (req, res) => { ... });

export default router;
