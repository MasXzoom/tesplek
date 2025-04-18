// Import dependencies
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Konfigurasi dari file .env
const token = process.env.TELEGRAM_BOT_TOKEN;
const apiUrl = process.env.API_URL;
const testflightUrl = process.env.TESTFLIGHT_URL || 'https://testflight.apple.com';

// Membuat instance bot
const bot = new TelegramBot(token, { polling: true });

// Variabel untuk pemantauan TestFlight
const monitoredApps = {
  // Format: 'betaCode': { lastStatus: 'full'/'available', chatIds: [array of chat IDs to notify] }
};

// Interval waktu untuk pemeriksaan dalam milidetik (default: 30 menit)
const CHECK_INTERVAL = process.env.CHECK_INTERVAL || 30 * 60 * 1000;

// Handler untuk pesan /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Selamat datang! Saya adalah bot yang terhubung dengan API. Gunakan /help untuk melihat perintah yang tersedia.');
});

// Handler untuk pesan /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
Perintah yang tersedia:
/start - Memulai bot
/help - Menampilkan pesan bantuan
/data - Mengambil data dari API
/testflight [kode] - Memeriksa status beta app di TestFlight
/monitor [kode] - Memantau beta app dan beri tahu jika tersedia
/stopmonitor [kode] - Berhenti memantau beta app
/showmonitor - Menampilkan daftar beta yang sedang dipantau
/version [kode] - Mendapatkan info versi beta TestFlight
/screenshots [kode] - Menampilkan screenshot aplikasi (jika tersedia)
  `);
});

// Handler untuk pesan /data
bot.onText(/\/data/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Mengirim pesan loading
    bot.sendMessage(chatId, 'Mengambil data dari API...');
    
    // Memanggil API menggunakan axios
    const response = await axios.get(apiUrl);
    
    // Mengirim data dari API ke pengguna
    bot.sendMessage(chatId, `Data dari API:\n${JSON.stringify(response.data, null, 2)}`);
  } catch (error) {
    console.error('Error saat mengambil data:', error.message);
    bot.sendMessage(chatId, 'Maaf, terjadi kesalahan saat mengambil data dari API.');
  }
});

// Fungsi untuk memeriksa status TestFlight
async function checkTestFlightStatus(betaCode) {
  try {
    // Konfigurasi untuk request
    const config = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'max-age=0',
        'Cookie': 'geo=ID'
      }
    };
    
    // Request ke TestFlight
    const response = await axios.get(`${testflightUrl}/join/${betaCode}`, config);
    const html = response.data;
    
    // Ekstrak informasi app
    const titleMatch = html.match(/<title>Join the (.*?) beta - TestFlight - Apple<\/title>/);
    const appName = titleMatch ? titleMatch[1] : 'Unknown App';
    
    // Coba ekstrak ikon app
    const iconMatch = html.match(/background-image: url\((https:\/\/is\d+-ssl\.mzstatic\.com\/image\/thumb\/[^)]+)\)/);
    const iconUrl = iconMatch ? iconMatch[1] : null;
    
    // Ekstrak deskripsi
    const descMatch = html.match(/<p class="step3">(.*?)<\/p>/s);
    let description = descMatch ? descMatch[1].trim() : '';
    // Batasi deskripsi jika terlalu panjang
    if (description.length > 200) {
      description = description.substring(0, 200) + '...';
    }
    
    // Ekstrak versi beta (baru)
    let version = null;
    const versionMatch = html.match(/Version ([0-9.]+) \(Build ([0-9.]+)\)/);
    if (versionMatch) {
      version = {
        versionNumber: versionMatch[1],
        buildNumber: versionMatch[2]
      };
    }
    
    // Ekstrak screenshot (baru)
    const screenshots = [];
    const screenshotMatches = html.matchAll(/image:\s*url\((https:\/\/is\d+-ssl\.mzstatic\.com\/image\/thumb\/[^)]+)\)/g);
    if (screenshotMatches) {
      for (const match of screenshotMatches) {
        if (match[1] && !match[1].includes('Icon-Production') && !match[1].includes('Prod-0-0-1x_U007ephone')) {
          screenshots.push(match[1]);
        }
      }
    }
    
    // Tentukan status beta
    let status;
    if (html.includes('This beta is full.')) {
      status = 'full';
    } else if (html.includes('View in TestFlight') || html.includes('To join the') || 
               html.includes('open the link on your iPhone') || html.includes('Step 2')) {
      status = 'available';
    } else {
      status = 'unknown';
    }
    
    return { 
      status, 
      appName, 
      iconUrl, 
      description, 
      betaCode,
      version, 
      screenshots: screenshots.slice(0, 5)  // Ambil 5 screenshot pertama saja
    };
  } catch (error) {
    console.error(`Error memeriksa status TestFlight ${betaCode}:`, error.message);
    return { status: 'error', error: error.message, betaCode };
  }
}

// Handler untuk memeriksa status TestFlight
bot.onText(/\/testflight (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const betaCode = match[1]; // Kode beta dari pesan
  
  try {
    // Mengirim pesan loading
    bot.sendMessage(chatId, `Memeriksa status beta TestFlight dengan kode: ${betaCode}...`);
    
    const result = await checkTestFlightStatus(betaCode);
    
    if (result.status === 'full') {
      // Status: Beta penuh
      let message = `❌ *Beta ${result.appName} sudah penuh.*\n\nKode: \`${betaCode}\``;
      
      // Tambahkan info versi jika tersedia
      if (result.version) {
        message += `\n\n*Versi:* ${result.version.versionNumber} (Build ${result.version.buildNumber})`;
      }
      
      message += `\n[Lihat di TestFlight](${testflightUrl}/join/${betaCode})`;
      
      if (result.iconUrl) {
        await bot.sendPhoto(chatId, result.iconUrl, {
          caption: message,
          parse_mode: 'Markdown'
        });
      } else {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
    } else if (result.status === 'available') {
      // Status: Beta tersedia
      let message = `✅ *Beta ${result.appName} tersedia untuk diikuti!*\n\n`;
      
      if (result.description) {
        message += `${result.description}\n\n`;
      }
      
      // Tambahkan info versi jika tersedia
      if (result.version) {
        message += `*Versi:* ${result.version.versionNumber} (Build ${result.version.buildNumber})\n\n`;
      }
      
      message += `*Cara bergabung:*\n`;
      message += `1. Install aplikasi TestFlight dari App Store\n`;
      message += `2. Buka link: ${testflightUrl}/join/${betaCode}\n\n`;
      message += `Kode: \`${betaCode}\``;
      
      if (result.iconUrl) {
        await bot.sendPhoto(chatId, result.iconUrl, {
          caption: message,
          parse_mode: 'Markdown'
        });
      } else {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
      
      // Kirim screenshot jika tersedia (1-2 screenshot saja)
      if (result.screenshots && result.screenshots.length > 0) {
        await bot.sendMessage(chatId, `*Screenshot ${result.appName}:* (${result.screenshots.length} tersedia)`, { parse_mode: 'Markdown' });
        
        // Kirim 2 screenshot pertama
        for (let i = 0; i < Math.min(2, result.screenshots.length); i++) {
          await bot.sendPhoto(chatId, result.screenshots[i]);
        }
        
        if (result.screenshots.length > 2) {
          await bot.sendMessage(chatId, `Gunakan perintah \`/screenshots ${betaCode}\` untuk melihat semua screenshot.`, { parse_mode: 'Markdown' });
        }
      }
    } else {
      // Status tidak diketahui/tidak valid
      await bot.sendMessage(
        chatId, 
        `⚠️ Tidak dapat menentukan status beta dengan kode \`${betaCode}\`. Mungkin kode tidak valid atau halaman berubah format.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('Error saat memeriksa TestFlight:', error.message);
    bot.sendMessage(
      chatId, 
      `⚠️ Terjadi kesalahan saat memeriksa beta TestFlight: ${error.message}\n\nPastikan kode beta valid.`
    );
  }
});

// Handler untuk mendapatkan info versi beta
bot.onText(/\/version (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const betaCode = match[1]; // Kode beta dari pesan
  
  try {
    // Mengirim pesan loading
    bot.sendMessage(chatId, `Mengambil info versi untuk beta dengan kode: ${betaCode}...`);
    
    const result = await checkTestFlightStatus(betaCode);
    
    if (result.version) {
      let message = `📱 *Info Versi ${result.appName}*\n\n`;
      message += `*Versi:* ${result.version.versionNumber}\n`;
      message += `*Build:* ${result.version.buildNumber}\n`;
      message += `*Status:* ${result.status === 'full' ? '❌ Penuh' : result.status === 'available' ? '✅ Tersedia' : '⚠️ Tidak diketahui'}\n`;
      message += `*Kode Beta:* \`${betaCode}\``;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, `⚠️ Tidak dapat mengambil info versi untuk beta dengan kode \`${betaCode}\`.`, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Error saat mengambil info versi:', error.message);
    bot.sendMessage(
      chatId, 
      `⚠️ Terjadi kesalahan saat mengambil info versi: ${error.message}`
    );
  }
});

// Handler untuk mendapatkan screenshot aplikasi
bot.onText(/\/screenshots (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const betaCode = match[1]; // Kode beta dari pesan
  
  try {
    // Mengirim pesan loading
    bot.sendMessage(chatId, `Mencari screenshot untuk beta dengan kode: ${betaCode}...`);
    
    const result = await checkTestFlightStatus(betaCode);
    
    if (result.screenshots && result.screenshots.length > 0) {
      await bot.sendMessage(
        chatId, 
        `*Screenshot ${result.appName}* (${result.screenshots.length} ditemukan):`,
        { parse_mode: 'Markdown' }
      );
      
      // Kirim semua screenshot yang ditemukan (max 5 untuk menghindari spam)
      const maxScreenshots = Math.min(5, result.screenshots.length);
      for (let i = 0; i < maxScreenshots; i++) {
        await bot.sendPhoto(chatId, result.screenshots[i]);
        
        // Delay kecil untuk menghindari rate limit
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (result.screenshots.length > maxScreenshots) {
        await bot.sendMessage(
          chatId, 
          `⚠️ Hanya menampilkan ${maxScreenshots} dari ${result.screenshots.length} screenshot yang tersedia.`
        );
      }
    } else {
      await bot.sendMessage(
        chatId, 
        `⚠️ Tidak ditemukan screenshot untuk beta ${result.appName || 'ini'}.`
      );
    }
  } catch (error) {
    console.error('Error saat mengambil screenshot:', error.message);
    bot.sendMessage(
      chatId, 
      `⚠️ Terjadi kesalahan saat mengambil screenshot: ${error.message}`
    );
  }
});

// Handler untuk memulai pemantauan beta
bot.onText(/\/monitor (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const betaCode = match[1]; // Kode beta dari pesan
  
  try {
    // Periksa status saat ini
    const result = await checkTestFlightStatus(betaCode);
    
    // Inisialisasi atau update data pemantauan
    if (!monitoredApps[betaCode]) {
      monitoredApps[betaCode] = {
        lastStatus: result.status,
        chatIds: [chatId],
        appName: result.appName,
        lastChecked: new Date(),
        version: result.version
      };
    } else if (!monitoredApps[betaCode].chatIds.includes(chatId)) {
      monitoredApps[betaCode].chatIds.push(chatId);
      // Update nama app jika tidak diketahui sebelumnya
      if (monitoredApps[betaCode].appName === 'Unknown App' && result.appName !== 'Unknown App') {
        monitoredApps[betaCode].appName = result.appName;
      }
      // Update versi jika tersedia
      if (result.version) {
        monitoredApps[betaCode].version = result.version;
      }
    }
    
    let message = `🔔 Pemantauan beta *${result.appName}* dengan kode \`${betaCode}\` telah diaktifkan!\n\n`;
    message += `Status saat ini: ${result.status === 'full' ? '❌ Penuh' : result.status === 'available' ? '✅ Tersedia' : '⚠️ Tidak diketahui'}\n`;
    
    // Tambahkan info versi jika tersedia
    if (result.version) {
      message += `Versi: ${result.version.versionNumber} (Build ${result.version.buildNumber})\n`;
    }
    
    message += `\nAnda akan menerima notifikasi jika status berubah dari penuh menjadi tersedia.`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error saat mengaktifkan pemantauan:', error.message);
    bot.sendMessage(
      chatId,
      `⚠️ Terjadi kesalahan saat mengaktifkan pemantauan beta: ${error.message}`
    );
  }
});

// Handler untuk menghentikan pemantauan beta
bot.onText(/\/stopmonitor (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const betaCode = match[1]; // Kode beta dari pesan
  
  if (monitoredApps[betaCode] && monitoredApps[betaCode].chatIds.includes(chatId)) {
    // Hapus chatId dari daftar
    monitoredApps[betaCode].chatIds = monitoredApps[betaCode].chatIds.filter(id => id !== chatId);
    
    // Jika tidak ada yang memantau lagi, hapus dari daftar
    if (monitoredApps[betaCode].chatIds.length === 0) {
      delete monitoredApps[betaCode];
    }
    
    bot.sendMessage(
      chatId,
      `🔕 Pemantauan beta dengan kode \`${betaCode}\` telah dinonaktifkan.`,
      { parse_mode: 'Markdown' }
    );
  } else {
    bot.sendMessage(
      chatId,
      `⚠️ Anda tidak memantau beta dengan kode \`${betaCode}\`.`,
      { parse_mode: 'Markdown' }
    );
  }
});

// Handler untuk menampilkan beta yang dipantau
bot.onText(/\/showmonitor/, (msg) => {
  const chatId = msg.chat.id;
  
  // Filter beta yang dipantau oleh pengguna ini
  const userMonitored = Object.entries(monitoredApps).filter(
    ([_, app]) => app.chatIds.includes(chatId)
  );
  
  if (userMonitored.length === 0) {
    bot.sendMessage(chatId, '📝 Anda tidak memantau beta TestFlight apa pun.');
    return;
  }
  
  let message = '📝 *Daftar Beta TestFlight yang Dipantau:*\n\n';
  
  userMonitored.forEach(([betaCode, app]) => {
    const lastCheckedTime = app.lastChecked ? 
      `${app.lastChecked.toLocaleDateString()} ${app.lastChecked.toLocaleTimeString()}` : 
      'Belum diperiksa';
      
    message += `*${app.appName || 'App'}* (\`${betaCode}\`)\n`;
    message += `Status terakhir: ${app.lastStatus === 'full' ? '❌ Penuh' : app.lastStatus === 'available' ? '✅ Tersedia' : '⚠️ Tidak diketahui'}\n`;
    
    // Tambahkan info versi jika tersedia
    if (app.version) {
      message += `Versi: ${app.version.versionNumber} (Build ${app.version.buildNumber})\n`;
    }
    
    message += `Pemeriksaan terakhir: ${lastCheckedTime}\n\n`;
  });
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Fungsi untuk memeriksa semua beta yang dipantau
async function checkAllMonitoredApps() {
  console.log(`[${new Date().toISOString()}] Memeriksa ${Object.keys(monitoredApps).length} beta TestFlight yang dipantau...`);
  
  for (const [betaCode, app] of Object.entries(monitoredApps)) {
    try {
      const result = await checkTestFlightStatus(betaCode);
      const now = new Date();
      
      // Update status terakhir dan waktu pemeriksaan
      monitoredApps[betaCode].lastStatus = result.status;
      monitoredApps[betaCode].lastChecked = now;
      
      // Update nama app jika berubah
      if (result.appName !== 'Unknown App') {
        monitoredApps[betaCode].appName = result.appName;
      }
      
      // Update versi jika tersedia
      if (result.version) {
        monitoredApps[betaCode].version = result.version;
      }
      
      // Jika status berubah dari full ke available, beri tahu semua pengguna yang memantau beta ini
      if (app.lastStatus === 'full' && result.status === 'available') {
        console.log(`[${now.toISOString()}] Beta ${betaCode} (${result.appName}) sekarang TERSEDIA! Mengirim notifikasi ke ${app.chatIds.length} pengguna.`);
        
        let message = `🎉 *KABAR BAIK!* Beta *${result.appName}* sekarang TERSEDIA!\n\n`;
        
        if (result.description) {
          message += `${result.description}\n\n`;
        }
        
        // Tambahkan info versi jika tersedia
        if (result.version) {
          message += `*Versi:* ${result.version.versionNumber} (Build ${result.version.buildNumber})\n\n`;
        }
        
        message += `*Cara bergabung:*\n`;
        message += `1. Install aplikasi TestFlight dari App Store\n`;
        message += `2. Buka link: ${testflightUrl}/join/${betaCode}\n\n`;
        message += `Kode: \`${betaCode}\``;
        
        // Kirim notifikasi ke semua pengguna yang memantau
        for (const chatId of app.chatIds) {
          try {
            if (result.iconUrl) {
              await bot.sendPhoto(chatId, result.iconUrl, {
                caption: message,
                parse_mode: 'Markdown'
              });
            } else {
              await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            }
            
            // Kirim 1 screenshot jika tersedia
            if (result.screenshots && result.screenshots.length > 0) {
              await bot.sendPhoto(chatId, result.screenshots[0], {
                caption: `Screenshot ${result.appName} (${result.screenshots.length > 1 ? `+${result.screenshots.length-1} lainnya` : ''})`
              });
              
              if (result.screenshots.length > 1) {
                await bot.sendMessage(
                  chatId, 
                  `Gunakan perintah \`/screenshots ${betaCode}\` untuk melihat semua screenshot.`, 
                  { parse_mode: 'Markdown' }
                );
              }
            }
          } catch (notifyError) {
            console.error(`Error mengirim notifikasi ke ${chatId}:`, notifyError.message);
          }
        }
      }
    } catch (error) {
      console.error(`Error memeriksa beta ${betaCode}:`, error.message);
    }
    
    // Tidur sedikit antar permintaan untuk menghindari rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Jadwalkan pemeriksaan rutin
setInterval(checkAllMonitoredApps, CHECK_INTERVAL);

// Handler untuk semua pesan teks lainnya
bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Saya hanya memahami perintah. Gunakan /help untuk melihat perintah yang tersedia.');
  }
});

// Jalankan pemeriksaan pertama setelah 5 detik startup
setTimeout(checkAllMonitoredApps, 5000);

// Log ketika bot dimulai
console.log('Bot Telegram telah dimulai!'); 