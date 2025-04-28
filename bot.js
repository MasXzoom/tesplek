// Import dependencies
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Konfigurasi dari file .env
const token = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.CHANNEL_ID; // ID Channel untuk notifikasi
const apiUrl = process.env.API_URL; // Opsional, jika masih digunakan
const testflightUrl = process.env.TESTFLIGHT_URL || 'https://testflight.apple.com';

// Validasi konfigurasi penting
if (!token) {
  console.error("Error: TELEGRAM_BOT_TOKEN tidak ditemukan di .env");
  process.exit(1);
}
if (!channelId) {
  console.error("Error: CHANNEL_ID tidak ditemukan di .env");
  process.exit(1);
}

// Membuat instance bot
const bot = new TelegramBot(token); // Polling tidak diperlukan jika tidak ada interaksi

// Variabel untuk menyimpan status terakhir beta yang dipantau
const monitoredBetaStatus = {
  // Format: 'betaCode': { lastStatus: 'full'/'available'/'unknown', appName: '...', version: {...} }
};

// Interval waktu untuk pemeriksaan dalam milidetik
// Membaca dari .env, default ke 1800000ms (30 menit) jika tidak ada.
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '1800000', 10);

// Daftar beta kode yang akan selalu dipantau secara otomatis
const AUTO_MONITORED_BETAS = [
  // Masukkan kode beta yang ingin selalu dipantau di sini
  "72eyUWVE", // Instagram
  "Gu9kI6ky", // Capcut
  "1SyedSId", // Spotify
  "gdE4pRzI" // Discord
  // Tambahkan kode beta lainnya di sini jika perlu
];

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
      },
      // Tambahkan timeout untuk mencegah hang
      timeout: 15000 // 15 detik
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
    let description = descMatch ? descMatch[1].trim().replace(/<[^>]*>?/gm, '') : ''; // Hapus tag HTML
    // Batasi deskripsi jika terlalu panjang
    if (description.length > 200) {
      description = description.substring(0, 200) + '...';
    }
    
    // Ekstrak versi beta
    let version = null;
    const versionMatch = html.match(/Version ([0-9.]+) \(Build ([0-9.]+)\)/);
    if (versionMatch) {
      version = {
        versionNumber: versionMatch[1],
        buildNumber: versionMatch[2]
      };
    }
    
    // Ekstrak screenshot (tidak digunakan untuk notifikasi channel, bisa dihapus jika mau)
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
      screenshots: screenshots.slice(0, 1) // Hanya ambil 1 screenshot jika diperlukan
    };
  } catch (error) {
    // Tangani error spesifik seperti timeout atau network error
    let errorMessage = error.message;
    if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout';
    } else if (error.response) {
      errorMessage = `HTTP Error ${error.response.status}`;
    } 
    console.error(`Error memeriksa status TestFlight ${betaCode}:`, errorMessage);
    return { status: 'error', error: errorMessage, betaCode };
  }
}

// Fungsi untuk mengirim notifikasi ke channel
async function sendChannelNotification(betaInfo) {
  const { appName, description, version, betaCode, iconUrl, screenshots } = betaInfo;
  const now = new Date();

  console.log(`[${now.toISOString()}] Beta ${betaCode} (${appName}) sekarang TERSEDIA! Mengirim notifikasi ke channel ${channelId}.`);

  let message = `🚨 *TESTFLIGHT TERSEDIA!*\n\n`;
  message += `Beta *${appName}* tersedia untuk diikuti!\n\n`;
  
  if (description) {
    message += `${description}\n\n`;
  }
  
  if (version) {
    message += `*Versi:* ${version.versionNumber} (Build ${version.buildNumber})\n\n`;
  }
  
  message += `*Cara bergabung:*\n`;
  message += `1. Install aplikasi TestFlight dari App Store.\n`;
  message += `2. Buka link: ${testflightUrl}/join/${betaCode}\n\n`;
  message += `Kode: \`${betaCode}\``;

  try {
    if (iconUrl) {
      // Kirim foto dengan caption
      await bot.sendPhoto(channelId, iconUrl, {
        caption: message,
        parse_mode: 'Markdown'
      });
      // Kirim screenshot (jika ada) sebagai pesan terpisah untuk menghindari caption terpotong
      if (screenshots && screenshots.length > 0) {
         await new Promise(resolve => setTimeout(resolve, 500)); // Delay kecil
         await bot.sendPhoto(channelId, screenshots[0], {
             caption: `Screenshot ${appName}`
         });
      }
    } else {
      // Kirim pesan teks biasa
      await bot.sendMessage(channelId, message, { parse_mode: 'Markdown' });
      // Kirim screenshot jika ada
      if (screenshots && screenshots.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Delay kecil
        await bot.sendPhoto(channelId, screenshots[0], {
            caption: `Screenshot ${appName}`
        });
      }
    }
    console.log(`[${now.toISOString()}] Notifikasi untuk ${betaCode} berhasil dikirim ke channel ${channelId}.`);
  } catch (notifyError) {
    console.error(`[${now.toISOString()}] GAGAL mengirim notifikasi ke channel ${channelId} untuk ${betaCode}:`, notifyError.message);
    // Pertimbangkan penanganan error lebih lanjut, misal coba lagi atau notifikasi admin
    if (notifyError.response && notifyError.response.statusCode === 403) {
        console.error(`Pastikan bot adalah admin di channel ${channelId} dan memiliki izin mengirim pesan/media.`);
    } else if (notifyError.response && notifyError.response.statusCode === 400) {
        console.error(`Bad Request saat mengirim ke channel. Periksa format pesan atau ID channel.`);
    }
  }
}

// Fungsi utama untuk memeriksa semua beta yang dipantau
async function checkMonitoredBetas() {
  const now = new Date();
  console.log(`[${now.toISOString()}] Memulai pemeriksaan untuk ${AUTO_MONITORED_BETAS.length} beta TestFlight...`);
  let availableBetasCount = 0;
  
  for (const betaCode of AUTO_MONITORED_BETAS) {
    try {
      const result = await checkTestFlightStatus(betaCode);
      const previousStatusInfo = monitoredBetaStatus[betaCode];
      const previousStatus = previousStatusInfo ? previousStatusInfo.lastStatus : 'unknown';
      
      // Update status terakhir di memori
      monitoredBetaStatus[betaCode] = { 
          lastStatus: result.status,
          appName: result.appName, // Simpan nama app
          version: result.version // Simpan versi
      };
      
      // Log perubahan status (opsional, untuk debugging)
      if (result.status !== 'error' && result.status !== previousStatus) {
          console.log(`[${now.toISOString()}] Status ${betaCode} (${result.appName}) berubah dari ${previousStatus} -> ${result.status}`);
      }

      // Jika status berubah menjadi 'available' (dari status lain, termasuk unknown/error/full)
      if (result.status === 'available' && previousStatus !== 'available') {
         availableBetasCount++;
         await sendChannelNotification(result);
      }
      
    } catch (error) {
      // Error ini seharusnya sudah ditangani di checkTestFlightStatus, tapi sebagai jaring pengaman
      console.error(`[${now.toISOString()}] Error tidak terduga saat memproses beta ${betaCode}:`, error.message);
    }
    
    // Tambahkan jeda antar permintaan untuk menghindari rate limiting TestFlight
    // Jeda 5-10 detik direkomendasikan jika banyak kode beta
    await new Promise(resolve => setTimeout(resolve, 5000)); // Jeda 5 detik
  }
  console.log(`[${now.toISOString()}] Pemeriksaan selesai. ${availableBetasCount} beta baru tersedia ditemukan.`);
}

// Jalankan pemeriksaan pertama setelah beberapa detik startup
setTimeout(checkMonitoredBetas, 5000); 

// Jadwalkan pemeriksaan rutin
setInterval(checkMonitoredBetas, CHECK_INTERVAL);

// Log ketika bot dimulai
console.log('Bot Telegram (Mode Channel) telah dimulai!');
console.log(`Mengirim notifikasi ke Channel ID: ${channelId}`);
console.log(`Memantau ${AUTO_MONITORED_BETAS.length} kode beta: ${AUTO_MONITORED_BETAS.join(', ')}`);
console.log(`Interval pemeriksaan: ${CHECK_INTERVAL / 1000} detik (${CHECK_INTERVAL / 60000} menit)`); 