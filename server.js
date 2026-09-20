const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

console.log('🔑 Webhook URL:', DISCORD_WEBHOOK_URL ? '✅ Đã cấu hình' : '❌ THIẾU URL!');

// Map mã nhân viên → tên hiển thị (thêm/sửa danh sách của bạn)
const employeeNames = {
  'EMP000149': 'Nguyễn Thị Huyền',
  'P0001': 'Nguyễn Văn A',
  'P0002': 'Nguyễn Văn B',
  // Thêm nhân viên của bạn ở đây...
};

// Gửi tin vào Discord
async function sendDiscord(embed) {
  try {
    console.log('📤 Đang gửi tin đến Discord...');
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [embed],
      username: 'Bot Chấm Công'
    });
    console.log('✅ Gửi Discord THÀNH CÔNG!');
    return true;
  } catch (e) {
    console.error('❌ Lỗi gửi Discord:', e.response?.status || e.message);
    if (e.response?.data) console.error('Chi tiết:', e.response.data);
    return false;
  }
}

// Tạo tin nhắn đẹp
function buildEmbed(code, type, time, device) {
  const name = employeeNames[code] || `Mã: ${code}`;
  const isIn = type === 'checkin' || type === 'in';
  
  return {
    title: isIn ? '▶ NHÂN VIÊN VÀO CA' : '■ NHÂN VIÊN RA CA',
    color: isIn ? 5763719 : 15548997,
    fields: [
      { name: '👤 Nhân viên', value: `**${name}**`, inline: true },
      { name: '⏰ Thời gian', value: time || '—', inline: true },
      { name: '📍 Thiết bị', value: device || 'Máy chấm công', inline: false }
    ],
    footer: { text: 'Hệ thống chấm công DAHAHI' },
    timestamp: new Date().toISOString()
  };
}

// ===== WEBHOOK NHẬN DỮ LIỆU TỪ DAHAHI =====
app.post('/webhook/dahahi', async (req, res) => {
  try {
    const p = req.body;
    
    console.log('\n' + '═'.repeat(60));
    console.log('📩 NHẬN DỮ LIỆU TỪ DAHAHI:');
    console.log(JSON.stringify(p, null, 2));
    console.log('═'.repeat(60));

    // === ĐỌC TÊN TRƯỜNG THEO ĐỊNH DẠNG DAHAHI ===
    // Thử tất cả các tên trường có thể có của DAHAHI
    const code = p.employeeCode || p.maNhanVien || p.UserId || p.MaNhanVien || p.id || p.MaNV;
    const checkType = p.checkType || p.loaiSuKien || p.type || p.LoaiSuKien;
    const time = p.time || p.thoiGian || p.CheckTime || p.ThoiGian || p.TG;
    const device = p.deviceName || p.tenThietBi || p.DeviceName || p.ThietBi || p.MaMay;

    console.log(`🔍 Phân tích → Mã NV: ${code || '(trống)'} | Loại: ${checkType || '(trống)'} | Thời gian: ${time || '(trống)'}`);

    if (!code) {
      console.log('⚠️ KHÔNG TÌM THẤY MÃ NHÂN VIÊN! Dữ liệu trên đây là toàn bộ DAHAHI gửi.');
      return res.status(200).json({ ok: false, note: 'Thiếu mã nhân viên' });
    }

    // Xác định vào ca / ra ca
    const isIn = ['checkin', 'in', 'vao', 'Vào', '1', 1, true].includes(String(checkType).toLowerCase());
    const eventType = isIn ? 'checkin' : 'checkout';

    // Gửi Discord
    const embed = buildEmbed(code, eventType, time, device);
    const sent = await sendDiscord(embed);

    res.json({ ok: true, sent: sent, employee: code, eventType });
  } catch (e) {
    console.error('❌ LỖI XỬ LÝ:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== TEST NHANH =====
app.get('/test', async (req, res) => {
  try {
    if (!DISCORD_WEBHOOK_URL) {
      return res.send('❌ THIẾU biến môi trường DISCORD_WEBHOOK_URL trên Render!');
    }
    const embed = buildEmbed('EMP000149', 'checkin', new Date().toLocaleString('vi-VN'), 'Máy chấm công chính');
    const sent = await sendDiscord(embed);
    if (sent) {
      res.send('✅ Test thành công! Kiểm tra kênh Discord #cham-cong ngay!');
    } else {
      res.status(500).send('❌ Gửi thất bại — xem Logs trên Render chi tiết');
    }
  } catch (e) {
    res.status(500).send('❌ Lỗi: ' + e.message);
  }
});

// ===== KIỂM TRA TRẠNG THÁI =====
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    webhookConfigured: !!DISCORD_WEBHOOK_URL,
    message: 'Server đang chạy bình thường'
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy trên cổng ${PORT}`);
  console.log(`🔗 Webhook: POST /webhook/dahahi`);
  console.log(`🧪 Test: GET /test`);
});
