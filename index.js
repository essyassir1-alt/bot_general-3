const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

// Import AI System
const AIConfig = require('./ai-config.js');

// Initialize AI
const aiSystem = new AIConfig();
console.log('🤖 AI System Loaded - Natural Darija, Arabic, French, English');

// Database setup
const db = new sqlite3.Database('./bot_data.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, guild_id TEXT, reason TEXT, moderator TEXT, date TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, user_id TEXT, suggestion TEXT, date TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS tickets (user_id TEXT, channel_id TEXT, guild_id TEXT, created_at TEXT, PRIMARY KEY (user_id, guild_id))`);
    db.run(`CREATE TABLE IF NOT EXISTS ticket_config (guild_id TEXT PRIMARY KEY, panel_channel TEXT, category TEXT, log_channel TEXT, support_role TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS reaction_roles (guild_id TEXT, message_id TEXT, channel_id TEXT, emoji TEXT, role_id TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS verification_config (guild_id TEXT PRIMARY KEY, auto_role TEXT, verified_role TEXT, channel TEXT, image_url TEXT, setup_by TEXT, setup_at TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS user_stats (user_id TEXT PRIMARY KEY, messages INTEGER DEFAULT 0, voice_minutes INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1)`);
    db.run(`CREATE TABLE IF NOT EXISTS free_games_sent (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT UNIQUE, sent_at TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS auto_role_users (user_id TEXT PRIMARY KEY, guild_id TEXT, had_role INTEGER DEFAULT 1, last_seen TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS giveaways (id TEXT PRIMARY KEY, message_id TEXT, channel_id TEXT, prize TEXT, winners INTEGER, end_time INTEGER, hosted_by TEXT, ended INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS auto_voice (guild_id TEXT, user_id TEXT, channel_id TEXT, PRIMARY KEY (guild_id, user_id))`);
    db.run(`CREATE TABLE IF NOT EXISTS auto_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, trigger_word TEXT, response TEXT, created_by TEXT, created_at TEXT)`);
    
    // ========== NEW INVITE TABLES ==========
    db.run(`CREATE TABLE IF NOT EXISTS invites (
        guild_id TEXT,
        user_id TEXT,
        invite_code TEXT,
        uses INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS invite_uses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT,
        inviter_id TEXT,
        invitee_id TEXT,
        invite_code TEXT,
        joined_at TEXT
    )`);
    
    console.log('✅ Database ready');
});

// Config
const { BOT_TOKEN, LOG_CHANNEL_ID, MOD_ROLE_ID, AUTO_ROLE_ID, VOICE_CHANNEL_ID, WELCOME_CHANNEL_ID } = process.env;

const WELCOME_IMAGE_URL = "https://media.discordapp.net/attachments/1504944590162231326/1509687379198345378/BBCD65E5-E8A2-47BB-80A0-0A208431F3A6.png?ex=6a1abe2f&is=6a196caf&hm=b8d17e03f0614a9b9b92f10337f0cf995542b06646d7771e3393a5e2e2bb4d25&=&format=webp&quality=lossless&width=1705&height=682";
const AUTO_ROLE_ID_FIXED = "1508206937991413800";
const WELCOME_CHANNEL_ID_FIXED = "1509920672866897962";

if (!BOT_TOKEN) {
    console.error('❌ Missing BOT_TOKEN in .env file');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Voice tracking
const voiceStartTimes = new Map();
const activeFreeGameSessions = new Map();
const sentGamesCache = new Set();
const linkWarnCooldown = new Map();

// Auto Voice System
const autoVoiceCache = new Map();
const userPersonalChannels = new Map();

// Anti-spam tracking
const messageCooldown = new Map();

// Store users who had auto role (in-memory cache)
const autoRoleUsersCache = new Set();

// Auto Message System cache
const autoMessagesCache = new Map();

// ========== INVITE CACHE ==========
const inviteCache = new Map(); // guildId -> Map(inviteCode -> uses)

// Free games list
const FREE_STEAM_GAMES = [
    { id: 730, title: "Counter-Strike 2", desc: "Free-to-play competitive FPS.", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg", price: "$0.00", url: "https://store.steampowered.com/app/730/CounterStrike_2/" },
    { id: 570, title: "Dota 2", desc: "Popular MOBA game.", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/570/header.jpg", price: "$0.00", url: "https://store.steampowered.com/app/570/Dota_2/" },
    { id: 440, title: "Team Fortress 2", desc: "Class-based team shooter.", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/440/header.jpg", price: "$0.00", url: "https://store.steampowered.com/app/440/Team_Fortress_2/" },
    { id: 1172470, title: "Apex Legends", desc: "Battle royale shooter.", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1172470/header.jpg", price: "$0.00", url: "https://store.steampowered.com/app/1172470/Apex_Legends/" },
    { id: 1085660, title: "Destiny 2", desc: "Action MMO FPS.", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1085660/header.jpg", price: "$0.00", url: "https://store.steampowered.com/app/1085660/Destiny_2/" },
    { id: 444090, title: "Paladins", desc: "Fantasy team shooter.", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/444090/header.jpg", price: "$0.00", url: "https://store.steampowered.com/app/444090/Paladins/" },
    { id: 230410, title: "Warframe", desc: "Co-op space ninja.", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/230410/header.jpg", price: "$0.00", url: "https://store.steampowered.com/app/230410/Warframe/" },
    { id: 2169380, title: "The Finals", desc: "Competitive shooter.", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2169380/header.jpg", price: "$0.00", url: "https://store.steampowered.com/app/2169380/THE_FINALS/" },
    { id: 1477560, title: "Rocket League", desc: "Soccer with cars!", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1477560/header.jpg", price: "$0.00", url: "https://store.steampowered.com/app/1477560/Rocket_League/" },
    { id: 1238840, title: "PUBG", desc: "Battle royale.", image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1238840/header.jpg", price: "$0.00", url: "https://store.steampowered.com/app/1238840/PUBG_BATTLEGROUNDS/" }
];

async function loadSentGames() {
    return new Promise((resolve) => {
        db.all(`SELECT game_id FROM free_games_sent`, [], (err, rows) => {
            if (rows && rows.length) {
                rows.forEach(row => sentGamesCache.add(String(row.game_id)));
            }
            console.log(`📚 Loaded ${sentGamesCache.size} sent games`);
            resolve();
        });
    });
}

async function markGameAsSent(gameId) {
    return new Promise((resolve) => {
        db.run(`INSERT OR IGNORE INTO free_games_sent (game_id, sent_at) VALUES (?, ?)`, [String(gameId), new Date().toISOString()], () => {
            sentGamesCache.add(String(gameId));
            resolve();
        });
    });
}

async function getRandomFreeGame() {
    const available = FREE_STEAM_GAMES.filter(g => !sentGamesCache.has(String(g.id)));
    if (available.length === 0) {
        sentGamesCache.clear();
        db.run(`DELETE FROM free_games_sent`, []);
        return FREE_STEAM_GAMES[Math.floor(Math.random() * FREE_STEAM_GAMES.length)];
    }
    return available[Math.floor(Math.random() * available.length)];
}

async function sendFreeGameEmbed(channel, game) {
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(`🎮 ${game.title}`)
        .setURL(game.url)
        .setDescription(game.desc)
        .setThumbnail(game.image)
        .setImage(game.image)
        .addFields(
            { name: '💰 Price', value: `~~${game.price}~~ → **FREE!**`, inline: true },
            { name: '🔗 Download', value: `[Get Game](${game.url})`, inline: false }
        )
        .setFooter({ text: 'Free game every 3 minutes!' })
        .setTimestamp();
    await channel.send({ embeds: [embed] });
    await markGameAsSent(game.id);
}

// Helper functions
function isMod(member) {
    if (!member) return false;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    if (MOD_ROLE_ID && member.roles.cache.has(MOD_ROLE_ID)) return true;
    return false;
}

async function sendLog(guild, action, target, mod, reason) {
    const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!ch) return;
    const embed = new EmbedBuilder().setColor(0x2b2d31).setTitle(`📋 ${action}`)
        .addFields(
            { name: 'Mod', value: mod?.tag || 'System', inline: true },
            { name: 'Target', value: target?.tag || target || 'Unknown', inline: true },
            { name: 'Reason', value: reason || 'None', inline: false }
        ).setTimestamp();
    await ch.send({ embeds: [embed] });
}

async function getMember(guild, id) {
    try { return await guild.members.fetch(id); } catch { return null; }
}

function parseTime(t) {
    const m = t.match(/^(\d+)([smhd])$/);
    if (!m) return null;
    const v = parseInt(m[1]), u = m[2];
    if (u === 's') return v * 1000;
    if (u === 'm') return v * 60000;
    if (u === 'h') return v * 3600000;
    if (u === 'd') return v * 86400000;
    return null;
}

function fmtTime(ms) {
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return `${d} day(s)`;
    if (h > 0) return `${h} hour(s)`;
    if (m > 0) return `${m} minute(s)`;
    return `${Math.floor(ms / 1000)} second(s)`;
}

function formatVoiceTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// User stats functions
async function getUserStats(userId) {
    return new Promise((resolve) => {
        db.get(`SELECT * FROM user_stats WHERE user_id = ?`, [userId], (err, row) => {
            resolve(row || { messages: 0, voice_minutes: 0, xp: 0, level: 1 });
        });
    });
}

function updateMessageStats(userId, messages = 1) {
    db.get(`SELECT * FROM user_stats WHERE user_id = ?`, [userId], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO user_stats (user_id, messages, voice_minutes, xp, level) VALUES (?, ?, ?, ?, 1)`, [userId, messages, 0, messages]);
        } else {
            let newXp = row.xp + messages;
            let newLevel = row.level;
            while (newXp >= newLevel * 100) { newXp -= newLevel * 100; newLevel++; }
            db.run(`UPDATE user_stats SET messages = messages + ?, xp = ?, level = ? WHERE user_id = ?`, [messages, newXp, newLevel, userId]);
        }
    });
}

async function updateVoiceStats(userId, additionalMinutes) {
    return new Promise((resolve) => {
        db.get(`SELECT * FROM user_stats WHERE user_id = ?`, [userId], (err, row) => {
            if (!row) {
                db.run(`INSERT INTO user_stats (user_id, messages, voice_minutes, xp, level) VALUES (?, 0, ?, ?, 1)`, [userId, additionalMinutes, Math.floor(additionalMinutes / 60)], () => resolve());
            } else {
                const newVoice = row.voice_minutes + additionalMinutes;
                let newXp = row.xp + Math.floor(additionalMinutes / 60);
                let newLevel = row.level;
                while (newXp >= newLevel * 100) { newXp -= newLevel * 100; newLevel++; }
                db.run(`UPDATE user_stats SET voice_minutes = ?, xp = ?, level = ? WHERE user_id = ?`, [newVoice, newXp, newLevel, userId], () => resolve());
            }
        });
    });
}

async function getAllStats() {
    return new Promise((resolve) => {
        db.all(`SELECT user_id, messages, voice_minutes, xp, level FROM user_stats ORDER BY xp DESC`, (err, rows) => {
            resolve(rows || []);
        });
    });
}

function addWarning(uid, gid, reason, mod) {
    return new Promise((r) => {
        db.run(`INSERT INTO warnings (user_id, guild_id, reason, moderator, date) VALUES (?, ?, ?, ?, ?)`,
            [uid, gid, reason, mod, new Date().toISOString()], () => r());
    });
}

function getWarnCount(uid, gid) {
    return new Promise((r) => {
        db.get(`SELECT COUNT(*) as c FROM warnings WHERE user_id = ? AND guild_id = ?`, [uid, gid], (err, row) => r(row ? row.c : 0));
    });
}

// ========== INVITE DATABASE FUNCTIONS ==========

function getInviteCount(guildId, userId) {
    return new Promise((resolve) => {
        db.get(`SELECT uses FROM invites WHERE guild_id = ? AND user_id = ?`, [guildId, userId], (err, row) => {
            resolve(row ? row.uses : 0);
        });
    });
}

function addInviteUse(guildId, inviterId, inviteeId, inviteCode) {
    return new Promise((resolve) => {
        db.run(`INSERT INTO invite_uses (guild_id, inviter_id, invitee_id, invite_code, joined_at) VALUES (?, ?, ?, ?, ?)`,
            [guildId, inviterId, inviteeId, inviteCode, new Date().toISOString()], (err) => {
                if (err) console.error('Error adding invite use:', err);
                // Increase invite count for inviter
                db.run(`INSERT INTO invites (guild_id, user_id, invite_code, uses) VALUES (?, ?, ?, 1)
                        ON CONFLICT(guild_id, user_id) DO UPDATE SET uses = uses + 1, invite_code = excluded.invite_code`,
                    [guildId, inviterId, inviteCode], (err2) => {
                        if (err2) console.error('Error updating invite count:', err2);
                        resolve();
                    });
            });
    });
}

function getInviteUses(guildId, inviterId) {
    return new Promise((resolve) => {
        db.all(`SELECT invitee_id, invite_code, joined_at FROM invite_uses WHERE guild_id = ? AND inviter_id = ? ORDER BY joined_at DESC LIMIT 10`,
            [guildId, inviterId], (err, rows) => {
                resolve(rows || []);
            });
    });
}

function getAllInviteCodes(guildId) {
    return new Promise((resolve) => {
        db.all(`SELECT user_id, invite_code, uses FROM invites WHERE guild_id = ?`, [guildId], (err, rows) => {
            resolve(rows || []);
        });
    });
}

// ========== AUTO MESSAGE SYSTEM FUNCTIONS ==========
async function saveAutoMessage(guildId, triggerWord, response, createdBy) {
    return new Promise((resolve) => {
        db.run(`INSERT OR REPLACE INTO auto_messages (guild_id, trigger_word, response, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
            [guildId, triggerWord.toLowerCase(), response, createdBy, new Date().toISOString()], (err) => {
                if (!err) {
                    autoMessagesCache.set(`${guildId}-${triggerWord.toLowerCase()}`, response);
                }
                resolve();
            });
    });
}

async function getAutoMessage(guildId, triggerWord) {
    return new Promise((resolve) => {
        const cached = autoMessagesCache.get(`${guildId}-${triggerWord.toLowerCase()}`);
        if (cached) {
            resolve(cached);
            return;
        }
        
        db.get(`SELECT response FROM auto_messages WHERE guild_id = ? AND trigger_word = ?`, 
            [guildId, triggerWord.toLowerCase()], (err, row) => {
                if (row && !err) {
                    autoMessagesCache.set(`${guildId}-${triggerWord.toLowerCase()}`, row.response);
                    resolve(row.response);
                } else {
                    resolve(null);
                }
            });
    });
}

async function deleteAutoMessage(guildId, triggerWord) {
    return new Promise((resolve) => {
        db.run(`DELETE FROM auto_messages WHERE guild_id = ? AND trigger_word = ?`, 
            [guildId, triggerWord.toLowerCase()], (err) => {
                if (!err) {
                    autoMessagesCache.delete(`${guildId}-${triggerWord.toLowerCase()}`);
                }
                resolve();
            });
    });
}

async function getAllAutoMessages(guildId) {
    return new Promise((resolve) => {
        db.all(`SELECT trigger_word, response, created_by, created_at FROM auto_messages WHERE guild_id = ?`, 
            [guildId], (err, rows) => {
                resolve(rows || []);
            });
    });
}

// ========== AUTO ROLE DATABASE FUNCTIONS ==========
function saveAutoRoleUser(userId, guildId) {
    return new Promise((resolve) => {
        db.run(`INSERT OR REPLACE INTO auto_role_users (user_id, guild_id, had_role, last_seen) VALUES (?, ?, 1, ?)`,
            [userId, guildId, new Date().toISOString()], () => {
                autoRoleUsersCache.add(`${guildId}-${userId}`);
                resolve();
            });
    });
}

function hadAutoRoleBefore(userId, guildId) {
    return new Promise((resolve) => {
        const cached = autoRoleUsersCache.has(`${guildId}-${userId}`);
        if (cached) {
            resolve(true);
            return;
        }
        db.get(`SELECT * FROM auto_role_users WHERE user_id = ? AND guild_id = ?`, [userId, guildId], (err, row) => {
            resolve(!!row);
        });
    });
}

// Ticket system
function saveTicketConfig(gid, panel, cat, log, role) { db.run(`INSERT OR REPLACE INTO ticket_config VALUES (?, ?, ?, ?, ?)`, [gid, panel, cat, log, role]); }
function getTicketConfig(gid) { return new Promise((r) => { db.get(`SELECT * FROM ticket_config WHERE guild_id = ?`, [gid], (err, row) => r(row)); }); }
function saveTicket(uid, cid, gid) { db.run(`INSERT OR REPLACE INTO tickets VALUES (?, ?, ?, ?)`, [uid, cid, gid, new Date().toISOString()]); }
function getTicket(uid, gid) { return new Promise((r) => { db.get(`SELECT * FROM tickets WHERE user_id = ? AND guild_id = ?`, [uid, gid], (err, row) => r(row)); }); }
function delTicket(uid, gid) { db.run(`DELETE FROM tickets WHERE user_id = ? AND guild_id = ?`, [uid, gid]); }

async function sendTicketPanel(ch, cfg) {
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎫 SUPPORT').setDescription('Click below to create a ticket.').setTimestamp();
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('Open Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary));
    await ch.send({ embeds: [embed], components: [row] });
}

// Reaction roles
function saveRR(gid, mid, cid, emoji, rid) { db.run(`INSERT OR REPLACE INTO reaction_roles VALUES (?, ?, ?, ?, ?)`, [gid, mid, cid, emoji, rid]); }
function getRR(gid, mid) { return new Promise((r) => { db.all(`SELECT * FROM reaction_roles WHERE guild_id = ? AND message_id = ?`, [gid, mid], (err, rows) => r(rows || [])); }); }

async function sendRRPanel(ch, phoneId, pcId) {
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('📱 DEVICE ROLES').setDescription('Click a button to get your role!')
        .addFields({ name: '📱 Phone', value: `<@&${phoneId}>`, inline: true }, { name: '💻 PC', value: `<@&${pcId}>`, inline: true });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('role_phone').setLabel('Phone').setEmoji('📱').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('role_pc').setLabel('PC').setEmoji('💻').setStyle(ButtonStyle.Secondary)
    );
    const msg = await ch.send({ embeds: [embed], components: [row] });
    saveRR(ch.guild.id, msg.id, ch.id, '📱', phoneId);
    saveRR(ch.guild.id, msg.id, ch.id, '💻', pcId);
}

// Verification
function saveVerif(gid, auto, verified, ch, img, by) { db.run(`INSERT OR REPLACE INTO verification_config VALUES (?, ?, ?, ?, ?, ?, ?)`, [gid, auto, verified, ch, img, by, new Date().toISOString()]); }
function getVerif(gid) { return new Promise((r) => { db.get(`SELECT * FROM verification_config WHERE guild_id = ?`, [gid], (err, row) => r(row)); }); }

async function sendVerifPanel(ch) {
    const cfg = await getVerif(ch.guild.id);
    if (!cfg) return ch.send('❌ Not configured! Use `-verif`');
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('✅ VERIFY').setDescription(`Welcome to ${ch.guild.name}!\nClick below to verify.`)
        .setImage(cfg.image_url).setThumbnail(ch.guild.iconURL()).setTimestamp();
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_button').setLabel('Verify').setEmoji('✅').setStyle(ButtonStyle.Success));
    await ch.send({ embeds: [embed], components: [row] });
}

// Announcements
async function sendAnn(ch, msg) {
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('📢 ANNOUNCEMENT').setDescription(msg).setThumbnail(ch.guild.iconURL()).setTimestamp();
    await ch.send({ embeds: [embed] });
}

// Setup collectors
async function setupTicket(msg) {
    const filter = (m) => m.author.id === msg.author.id;
    let step = 0;
    const cfg = {};
    const questions = ['Panel Channel ID:', 'Category ID:', 'Log Channel ID:', 'Support Role ID:'];
    const names = ['panel_channel', 'category', 'log_channel', 'support_role'];
    await msg.reply(questions[0]);
    const coll = msg.channel.createMessageCollector({ filter, time: 60000, max: 4 });
    coll.on('collect', async (m) => {
        cfg[names[step]] = m.content.trim();
        step++;
        if (step < 4) await m.reply(questions[step]);
        else {
            coll.stop();
            saveTicketConfig(msg.guild.id, cfg.panel_channel, cfg.category, cfg.log_channel, cfg.support_role);
            await m.reply('✅ Ticket system configured! Use `-ticket`');
        }
    });
}

async function setupRR(msg) {
    const filter = (m) => m.author.id === msg.author.id;
    let step = 0;
    const roles = {};
    const questions = ['Phone Role ID:', 'PC Role ID:'];
    await msg.reply(questions[0]);
    const coll = msg.channel.createMessageCollector({ filter, time: 60000, max: 2 });
    coll.on('collect', async (m) => {
        roles[step === 0 ? 'phone' : 'pc'] = m.content.trim();
        step++;
        if (step < 2) await m.reply(questions[step]);
        else {
            coll.stop();
            await sendRRPanel(msg.channel, roles.phone, roles.pc);
            await m.reply('✅ Reaction role panel created!');
        }
    });
}

async function setupVerif(msg) {
    const filter = (m) => m.author.id === msg.author.id;
    let step = 0;
    const cfg = {};
    const questions = ['Auto Role ID:', 'Verified Role ID:', 'Channel ID:', 'Image URL:'];
    const names = ['auto_role', 'verified_role', 'channel', 'image_url'];
    await msg.reply('🔧 Verification Setup\n' + questions[0]);
    const coll = msg.channel.createMessageCollector({ filter, time: 120000, max: 4 });
    coll.on('collect', async (m) => {
        const val = m.content.trim();
        if (step < 3 && !val.match(/^\d+$/)) return m.reply('❌ Invalid ID');
        if (step === 3 && !val.match(/^https?:\/\//)) return m.reply('❌ Invalid URL');
        cfg[names[step]] = val;
        step++;
        if (step < 4) await m.reply(questions[step]);
        else {
            coll.stop();
            saveVerif(msg.guild.id, cfg.auto_role, cfg.verified_role, cfg.channel, cfg.image_url, msg.author.id);
            const ch = msg.guild.channels.cache.get(cfg.channel);
            if (ch) await sendVerifPanel(ch);
            await m.reply(`✅ Verification configured! Panel sent to <#${cfg.channel}>`);
        }
    });
}

// Anti-link regex - matches ALL types of links
const LINK_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|discord\.com\/invite\/[^\s]+|steamcommunity\.com\/[^\s]+|twitch\.tv\/[^\s]+|youtube\.com\/[^\s]+|youtu\.be\/[^\s]+|twitter\.com\/[^\s]+|x\.com\/[^\s]+|t\.me\/[^\s]+|telegram\.me\/[^\s]+|roblox\.com\/[^\s]+)/i;

// Voice channel auto-join
let currentVoiceConnection = null;
let reconnectTimeout = null;

async function joinVoiceChannelProper() {
    if (!VOICE_CHANNEL_ID) return;
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
        if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) return;
        
        const existingConnection = getVoiceConnection(guild.id);
        if (existingConnection && existingConnection.joinConfig.channelId === VOICE_CHANNEL_ID) return;
        if (existingConnection) existingConnection.destroy();
        
        const connection = joinVoiceChannel({
            channelId: VOICE_CHANNEL_ID,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });
        
        currentVoiceConnection = connection;
        connection.on(VoiceConnectionStatus.Ready, () => console.log(`🎤 Joined voice channel: ${voiceChannel.name}`));
        connection.on(VoiceConnectionStatus.Disconnected, () => {
            if (!reconnectTimeout) {
                reconnectTimeout = setTimeout(() => {
                    reconnectTimeout = null;
                    joinVoiceChannelProper();
                }, 10000);
            }
        });
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    } catch (error) {
        console.error(`❌ Voice join error: ${error.message}`);
    }
}

// ========== AUTO VOICE SYSTEM FUNCTIONS ==========

async function addAutoVoice(guildId, userId, channelId) {
    return new Promise((resolve) => {
        db.run(`INSERT OR REPLACE INTO auto_voice (guild_id, user_id, channel_id) VALUES (?, ?, ?)`, 
            [guildId, userId, channelId], (err) => {
                if (!err) {
                    autoVoiceCache.set(`${guildId}-${userId}`, channelId);
                }
                resolve();
            });
    });
}

async function removeAutoVoice(guildId, userId) {
    return new Promise((resolve) => {
        db.run(`DELETE FROM auto_voice WHERE guild_id = ? AND user_id = ?`, 
            [guildId, userId], (err) => {
                if (!err) {
                    autoVoiceCache.delete(`${guildId}-${userId}`);
                }
                resolve();
            });
    });
}

async function getAutoVoice(guildId, userId) {
    return new Promise((resolve) => {
        const cached = autoVoiceCache.get(`${guildId}-${userId}`);
        if (cached) {
            resolve({ channel_id: cached });
            return;
        }
        
        db.get(`SELECT channel_id FROM auto_voice WHERE guild_id = ? AND user_id = ?`, 
            [guildId, userId], (err, row) => {
                if (row && !err) {
                    autoVoiceCache.set(`${guildId}-${userId}`, row.channel_id);
                }
                resolve(row);
            });
    });
}

async function createPersonalVoiceChannel(member, triggerChannel) {
    const category = triggerChannel.parent;
    const channelName = member.user.username;
    
    try {
        const newChannel = await member.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: category,
            userLimit: 0,
            permissionOverwrites: [
                {
                    id: member.id,
                    allow: [
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.MuteMembers,
                        PermissionsBitField.Flags.DeafenMembers,
                        PermissionsBitField.Flags.MoveMembers,
                        PermissionsBitField.Flags.Connect,
                        PermissionsBitField.Flags.Speak
                    ],
                },
                {
                    id: member.guild.id,
                    allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak],
                }
            ]
        });
        
        userPersonalChannels.set(newChannel.id, member.id);
        
        await member.voice.setChannel(newChannel);
        return newChannel;
    } catch (error) {
        console.error('Error creating personal voice channel:', error);
        return null;
    }
}

// Voice Control Panel
async function sendVoiceControlPanel(textChannel, voiceChannelId) {
    const voiceChannel = textChannel.guild.channels.cache.get(voiceChannelId);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
        return textChannel.send('❌ Invalid voice channel ID! Please provide a valid voice channel ID.');
    }
    
    const channelOwner = userPersonalChannels.get(voiceChannel.id);
    if (channelOwner !== textChannel.author.id && !isMod(textChannel.member)) {
        return textChannel.send('❌ You can only control your own personal voice channel!');
    }
    
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎤 Voice Control Panel')
        .setDescription(`Controlling: **${voiceChannel.name}**`)
        .addFields(
            { name: '👑 Owner', value: `<@${channelOwner}>`, inline: true },
            { name: '👥 Members', value: `${voiceChannel.members.size} users`, inline: true },
            { name: '🔒 Status', value: voiceChannel.permissionsFor(voiceChannel.guild.id).has(PermissionsBitField.Flags.Connect) ? 'Public' : 'Locked', inline: true }
        )
        .setFooter({ text: 'Use the buttons below to manage your voice channel' })
        .setTimestamp();
    
    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(`vc_lock_${voiceChannel.id}`).setLabel('🔒 Lock').setStyle(ButtonStyle.Secondary).setEmoji('🔒'),
            new ButtonBuilder().setCustomId(`vc_unlock_${voiceChannel.id}`).setLabel('🔓 Unlock').setStyle(ButtonStyle.Secondary).setEmoji('🔓'),
            new ButtonBuilder().setCustomId(`vc_hide_${voiceChannel.id}`).setLabel('👻 Hide').setStyle(ButtonStyle.Secondary).setEmoji('👻'),
            new ButtonBuilder().setCustomId(`vc_unhide_${voiceChannel.id}`).setLabel('👁️ Unhide').setStyle(ButtonStyle.Secondary).setEmoji('👁️')
        );
    
    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(`vc_kick_${voiceChannel.id}`).setLabel('👢 Kick User').setStyle(ButtonStyle.Danger).setEmoji('👢'),
            new ButtonBuilder().setCustomId(`vc_muteall_${voiceChannel.id}`).setLabel('🔇 Mute All').setStyle(ButtonStyle.Danger).setEmoji('🔇'),
            new ButtonBuilder().setCustomId(`vc_unmuteall_${voiceChannel.id}`).setLabel('🔊 Unmute All').setStyle(ButtonStyle.Success).setEmoji('🔊')
        );
    
    const row3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(`vc_rename_${voiceChannel.id}`).setLabel('✏️ Rename').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
            new ButtonBuilder().setCustomId(`vc_limit_${voiceChannel.id}`).setLabel('👥 User Limit').setStyle(ButtonStyle.Primary).setEmoji('👥'),
            new ButtonBuilder().setCustomId(`vc_transfer_${voiceChannel.id}`).setLabel('🔄 Transfer').setStyle(ButtonStyle.Primary).setEmoji('🔄')
        );
    
    const row4 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(`vc_info_${voiceChannel.id}`).setLabel('ℹ️ Info').setStyle(ButtonStyle.Secondary).setEmoji('ℹ️')
        );
    
    await textChannel.send({ embeds: [embed], components: [row1, row2, row3, row4] });
}

// ========== KHITAR COMMAND ==========
async function khtarWinner(message, messageId) {
    try {
        const targetMessage = await message.channel.messages.fetch(messageId);
        
        if (!targetMessage) {
            return message.reply('❌ Message not found! Make sure the message ID is correct and in this channel.');
        }
        
        const reactions = targetMessage.reactions.cache;
        
        if (reactions.size === 0) {
            return message.reply('❌ No reactions found on that message!');
        }
        
        const allReactors = new Set();
        
        for (const [emoji, reaction] of reactions) {
            try {
                const users = await reaction.users.fetch();
                users.forEach(user => {
                    if (!user.bot) {
                        allReactors.add(user);
                    }
                });
            } catch (error) {
                console.error(`Error fetching users for reaction ${emoji}:`, error.message);
            }
        }
        
        const reactorList = Array.from(allReactors);
        
        if (reactorList.length === 0) {
            return message.reply('❌ No valid users found in the reactions! (Bots are ignored)');
        }
        
        const randomIndex = Math.floor(Math.random() * reactorList.length);
        const winner = reactorList[randomIndex];
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🎉 KHITAR - WINNER SELECTED 🎉')
            .setDescription(`🎊 **Congratulations <@${winner.id}>!** 🎊\n\nYou have been randomly selected as the winner!`)
            .addFields(
                { name: '📊 Total Participants', value: `${reactorList.length} users`, inline: true },
                { name: '🎲 Winning Chance', value: `${(1 / reactorList.length * 100).toFixed(1)}%`, inline: true },
                { name: '🔗 Original Message', value: `[Jump to message](${targetMessage.url})`, inline: false }
            )
            .setThumbnail(winner.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
        
        await message.reply({ content: `🎉 Congratulations ${winner.toString()}! 🎉`, embeds: [embed] });
        
        try {
            await winner.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFFD700)
                        .setTitle('🎉 You Won a Giveaway! 🎉')
                        .setDescription(`You were randomly selected as the winner in **${message.guild.name}**!`)
                        .addFields({ name: '📝 Message Link', value: `[Click here](${targetMessage.url})`, inline: true })
                        .setTimestamp()
                ]
            });
        } catch (dmError) {
            console.log(`Could not DM winner ${winner.tag}: ${dmError.message}`);
        }
        
    } catch (error) {
        console.error('Error in khtar command:', error);
        if (error.code === 10008) {
            return message.reply('❌ Message not found! The message ID might be invalid or the message was deleted.');
        }
        return message.reply('❌ An error occurred while trying to pick a winner. Make sure the message ID is correct and the message has reactions.');
    }
}

// ========== AUTO MESSAGE RESPONSE HANDLER ==========
async function handleAutoMessage(message) {
    if (message.author.bot) return;
    if (message.content.startsWith('-')) return;
    
    const content = message.content.toLowerCase();
    const autoMessages = await getAllAutoMessages(message.guild.id);
    
    for (const autoMsg of autoMessages) {
        const triggerWord = autoMsg.trigger_word.toLowerCase();
        if (content.includes(triggerWord)) {
            await message.reply(autoMsg.response);
            console.log(`📨 Auto message triggered for "${triggerWord}" in ${message.guild.name}`);
            break;
        }
    }
}

// ========== MASS DM COMMAND ==========
async function sendMassDM(member, message, author) {
    const guild = member.guild;
    const members = await guild.members.fetch();
    let successCount = 0;
    let failCount = 0;
    
    const statusMsg = await author.send(`🔄 **Sending mass DM to all members...**\n📊 Total members: ${members.size}\n⏳ This may take a while...`);
    
    for (const [memberId, member] of members) {
        if (member.user.bot) continue;
        
        try {
            await member.send(message);
            successCount++;
            
            if ((successCount + failCount) % 10 === 0) {
                await statusMsg.edit(`🔄 **Progress:** ${successCount + failCount}/${members.size} | ✅ Success: ${successCount} | ❌ Failed: ${failCount}`);
            }
            
            await new Promise(r => setTimeout(r, 500));
        } catch (error) {
            failCount++;
            console.log(`Failed to DM ${member.user.tag}: ${error.message}`);
        }
    }
    
    await statusMsg.edit(`✅ **Mass DM Completed!**\n📊 Total members: ${members.size}\n✅ Success: ${successCount}\n❌ Failed: ${failCount}\n📝 Message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
    
    return { successCount, failCount };
}

// ========== ROLE ASSIGNMENT FUNCTIONS ==========

async function assignRoleToAllMembers(guild, roleId, author) {
    const role = guild.roles.cache.get(roleId);
    if (!role) {
        return { success: false, message: '❌ Role not found! Make sure the role ID is correct.' };
    }
    
    let successCount = 0;
    let failCount = 0;
    const members = await guild.members.fetch();
    const totalMembers = members.size;
    
    const statusMsg = await author.send(`🔄 Assigning role **${role.name}** to all ${totalMembers} members... This may take a while.`);
    
    for (const [memberId, member] of members) {
        if (member.user.bot) continue;
        
        try {
            if (!member.roles.cache.has(roleId)) {
                await member.roles.add(role);
                successCount++;
            }
        } catch (error) {
            failCount++;
            console.error(`Failed to add role to ${member.user.tag}:`, error.message);
        }
        
        if ((successCount + failCount) % 50 === 0) {
            await statusMsg.edit(`🔄 Progress: ${successCount + failCount}/${totalMembers} | ✅ Success: ${successCount} | ❌ Failed: ${failCount}`);
        }
    }
    
    await statusMsg.edit(`✅ Completed! Assigned **${role.name}** to ${successCount} members. Failed: ${failCount}`);
    return { success: true, successCount, failCount };
}

async function removeRoleFromAllMembers(guild, roleId, author) {
    const role = guild.roles.cache.get(roleId);
    if (!role) {
        return { success: false, message: '❌ Role not found! Make sure the role ID is correct.' };
    }
    
    let successCount = 0;
    let failCount = 0;
    const members = await guild.members.fetch();
    const totalMembers = members.size;
    
    const statusMsg = await author.send(`🔄 Removing role **${role.name}** from all members... This may take a while.`);
    
    for (const [memberId, member] of members) {
        if (member.user.bot) continue;
        
        try {
            if (member.roles.cache.has(roleId)) {
                await member.roles.remove(role);
                successCount++;
            }
        } catch (error) {
            failCount++;
            console.error(`Failed to remove role from ${member.user.tag}:`, error.message);
        }
        
        if ((successCount + failCount) % 50 === 0) {
            await statusMsg.edit(`🔄 Progress: ${successCount + failCount}/${totalMembers} | ✅ Success: ${successCount} | ❌ Failed: ${failCount}`);
        }
    }
    
    await statusMsg.edit(`✅ Completed! Removed **${role.name}** from ${successCount} members. Failed: ${failCount}`);
    return { success: true, successCount, failCount };
}

// ========== WELCOME MESSAGE WITH AUTO ROLE AND IMAGE ==========
async function sendWelcomeWithImage(member) {
    const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID_FIXED);
    if (!welcomeChannel) {
        console.log(`⚠️ Welcome channel ${WELCOME_CHANNEL_ID_FIXED} not found!`);
        return;
    }
    
    const autoRole = member.guild.roles.cache.get(AUTO_ROLE_ID_FIXED);
    if (autoRole) {
        try {
            const hadRoleBefore = await hadAutoRoleBefore(member.id, member.guild.id);
            
            if (hadRoleBefore) {
                await member.roles.add(autoRole);
                console.log(`✅ Re-added auto role to returning member: ${member.user.tag}`);
                
                const returnEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle(`🎉 WELCOME BACK TO ${member.guild.name.toUpperCase()}! 🎉`)
                    .setDescription(`**Hey ${member.toString()}!** Welcome back to the community! ✨\n\nWe're happy to see you again!`)
                    .setImage(WELCOME_IMAGE_URL)
                    .setThumbnail(member.user.displayAvatarURL({ size: 1024, dynamic: true }))
                    .addFields(
                        { name: '📅 Returned', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                        { name: '👋 Total Members', value: `${member.guild.memberCount}`, inline: true },
                        { name: '📚 Useful Commands', value: 'Use `-help` to see all available commands!', inline: false }
                    )
                    .setFooter({ text: `Welcome back ${member.user.username}!`, iconURL: member.guild.iconURL() })
                    .setTimestamp();
                
                await welcomeChannel.send({ content: `${member.toString()}`, embeds: [returnEmbed] });
            } else {
                await member.roles.add(autoRole);
                await saveAutoRoleUser(member.id, member.guild.id);
                console.log(`✅ Added auto role to new member: ${member.user.tag}`);
                
                const welcomeEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle(`🎉 WELCOME TO ${member.guild.name.toUpperCase()}! 🎉`)
                    .setDescription(`**Hey ${member.toString()}!** Welcome to the community! ✨\n\nWe're excited to have you here. Feel free to introduce yourself and enjoy your stay!`)
                    .setImage(WELCOME_IMAGE_URL)
                    .setThumbnail(member.user.displayAvatarURL({ size: 1024, dynamic: true }))
                    .addFields(
                        { name: '📅 Member Since', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                        { name: '👋 Total Members', value: `${member.guild.memberCount}`, inline: true },
                        { name: '📚 Useful Commands', value: 'Use `-help` to see all available commands!', inline: false }
                    )
                    .setFooter({ text: `Welcome ${member.user.username}!`, iconURL: member.guild.iconURL() })
                    .setTimestamp();
                
                await welcomeChannel.send({ content: `${member.toString()}`, embeds: [welcomeEmbed] });
            }
        } catch (error) {
            console.error(`❌ Failed to add auto role to ${member.user.tag}:`, error.message);
        }
    } else {
        console.log(`⚠️ Auto role ${AUTO_ROLE_ID_FIXED} not found!`);
    }
}

// Voice time saving
async function saveAllVoiceTime() {
    for (const [uid, startTime] of voiceStartTimes) {
        const mins = Math.floor((Date.now() - startTime) / 60000);
        if (mins > 0) await updateVoiceStats(uid, mins);
    }
}

// ========== GIVEAWAY SYSTEM ==========

const activeGiveawayTimeouts = new Map();

async function createGiveaway(channel, winners, durationMs, prize, hostedBy) {
    const endTime = Date.now() + durationMs;
    const giveawayId = `${channel.id}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    
    const embed = new EmbedBuilder()
        .setColor(0xFF69B4)
        .setTitle('🎉 GIVEAWAY 🎉')
        .setDescription(
            `**Prize:** ${prize}\n` +
            `**Winners:** ${winners}\n` +
            `**Hosted by:** ${hostedBy}\n` +
            `\nReact with 🎉 to enter!\n` +
            `**Ends:** <t:${Math.floor(endTime / 1000)}:R> (<t:${Math.floor(endTime / 1000)}:F>)`
        )
        .setFooter({ text: `Giveaway ID: ${giveawayId.substring(0, 10)}` })
        .setTimestamp(endTime);

    const message = await channel.send({ embeds: [embed] });
    await message.react('🎉');

    await new Promise((resolve) => {
        db.run(
            `INSERT INTO giveaways (id, message_id, channel_id, prize, winners, end_time, hosted_by, ended) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
            [giveawayId, message.id, channel.id, prize, winners, endTime, hostedBy],
            (err) => {
                if (err) console.error('Error saving giveaway:', err);
                resolve();
            }
        );
    });

    const timeout = setTimeout(() => endGiveaway(giveawayId), durationMs);
    activeGiveawayTimeouts.set(giveawayId, timeout);

    return giveawayId;
}

async function endGiveaway(giveawayId) {
    if (activeGiveawayTimeouts.has(giveawayId)) {
        clearTimeout(activeGiveawayTimeouts.get(giveawayId));
        activeGiveawayTimeouts.delete(giveawayId);
    }

    return new Promise((resolve) => {
        db.get(`SELECT * FROM giveaways WHERE id = ? AND ended = 0`, [giveawayId], async (err, giveaway) => {
            if (err || !giveaway) {
                resolve(null);
                return;
            }

            const channel = client.channels.cache.get(giveaway.channel_id);
            if (!channel) {
                db.run(`UPDATE giveaways SET ended = 1 WHERE id = ?`, [giveawayId]);
                resolve(null);
                return;
            }

            try {
                let message = null;
                try {
                    message = await channel.messages.fetch(giveaway.message_id);
                } catch (fetchError) {
                    console.log(`Giveaway message not found, marking as ended`);
                    db.run(`UPDATE giveaways SET ended = 1 WHERE id = ?`, [giveawayId]);
                    resolve(null);
                    return;
                }
                
                let participants = [];
                try {
                    const reaction = message.reactions.cache.get('🎉');
                    if (reaction) {
                        const users = await reaction.users.fetch();
                        participants = users.filter(user => !user.bot);
                    }
                } catch (reactionError) {
                    console.error('Error fetching reactions:', reactionError.message);
                }

                const winners = [];
                const participantList = [...participants];
                
                if (participantList.length > 0) {
                    const shuffled = [...participantList];
                    for (let i = shuffled.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                    }
                    
                    for (let i = 0; i < Math.min(giveaway.winners, shuffled.length); i++) {
                        winners.push(shuffled[i]);
                    }
                }

                db.run(`UPDATE giveaways SET ended = 1 WHERE id = ?`, [giveawayId]);

                try {
                    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
                        .setColor(0x808080)
                        .setDescription(
                            message.embeds[0].description + 
                            `\n\n**❌ GIVEAWAY ENDED ❌**\n` +
                            (winners.length > 0 ? `**Winners:** ${winners.map(w => w.toString()).join(', ')}` : '**No winners were selected**')
                        );
                    await message.edit({ embeds: [updatedEmbed] });
                } catch (editError) {
                    console.log(`Could not edit giveaway message:`, editError.message);
                }

                const resultEmbed = new EmbedBuilder()
                    .setColor(winners.length > 0 ? 0x22C55E : 0xEF4444)
                    .setTitle(winners.length > 0 ? '🎉 GIVEAWAY ENDED - WINNERS 🎉' : '🎉 GIVEAWAY ENDED - NO WINNERS 🎉')
                    .setDescription(
                        `**Prize:** ${giveaway.prize}\n` +
                        `**Total Entries:** ${participantList.length}\n` +
                        `**Winners:** ${giveaway.winners}\n` +
                        (winners.length > 0 ? `\n**🏆 Winners:**\n${winners.map(w => `${w.toString()}`).join('\n')}` : '\n❌ **No valid participants!**')
                    )
                    .setTimestamp();

                await channel.send({ embeds: [resultEmbed] });

                const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(0xFF69B4)
                        .setTitle('📋 GIVEAWAY ENDED')
                        .addFields(
                            { name: 'Prize', value: giveaway.prize, inline: true },
                            { name: 'Winners', value: winners.length.toString(), inline: true },
                            { name: 'Channel', value: `<#${giveaway.channel_id}>`, inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }

                resolve(winners);
            } catch (error) {
                console.error(`Error ending giveaway:`, error.message);
                db.run(`UPDATE giveaways SET ended = 1 WHERE id = ?`, [giveawayId]);
                resolve(null);
            }
        });
    });
}

async function cleanupExpiredGiveaways() {
    const now = Date.now();
    db.all(`SELECT id FROM giveaways WHERE ended = 0 AND end_time <= ?`, [now], async (err, rows) => {
        if (err || !rows) return;
        for (const row of rows) {
            await endGiveaway(row.id);
            await new Promise(r => setTimeout(r, 1000));
        }
        console.log(`🧹 Cleaned up ${rows.length} expired giveaways`);
    });
}

// ========== INVITE TRACKING FUNCTIONS ==========

async function cacheInvites(guild) {
    try {
        const invites = await guild.invites.fetch();
        const guildCache = new Map();
        invites.forEach(inv => {
            guildCache.set(inv.code, inv.uses || 0);
        });
        inviteCache.set(guild.id, guildCache);
        console.log(`📌 Cached ${guildCache.size} invites for ${guild.name}`);
    } catch (error) {
        console.error(`❌ Failed to fetch invites for ${guild.name}:`, error.message);
    }
}

async function processNewMember(member) {
    const guild = member.guild;
    if (!inviteCache.has(guild.id)) {
        await cacheInvites(guild);
        return;
    }

    try {
        const currentInvites = await guild.invites.fetch();
        const oldCache = inviteCache.get(guild.id);
        let usedInvite = null;
        let usedCode = null;

        // Find which invite got a new use
        for (const [code, invite] of currentInvites) {
            const oldUses = oldCache.get(code) || 0;
            const newUses = invite.uses || 0;
            if (newUses > oldUses) {
                usedInvite = invite;
                usedCode = code;
                break;
            }
        }

        // If no invite found (maybe user joined via vanity URL or other), ignore
        if (!usedInvite) {
            console.log(`⚠️ No invite found for ${member.user.tag}, joining via unknown method.`);
            // Update cache to new values anyway
            const newCache = new Map();
            currentInvites.forEach(inv => newCache.set(inv.code, inv.uses || 0));
            inviteCache.set(guild.id, newCache);
            return;
        }

        const inviterId = usedInvite.inviter?.id;
        if (!inviterId) {
            console.log(`⚠️ Invite code ${usedCode} has no inviter.`);
            return;
        }

        // Save the invite use
        await addInviteUse(guild.id, inviterId, member.id, usedCode);

        // Update cache
        const newCache = new Map();
        currentInvites.forEach(inv => newCache.set(inv.code, inv.uses || 0));
        inviteCache.set(guild.id, newCache);

        console.log(`✅ ${member.user.tag} joined via ${usedCode} (inviter: ${usedInvite.inviter?.tag})`);
    } catch (error) {
        console.error(`❌ Error processing invite for ${member.user.tag}:`, error.message);
    }
}

// ========== VOICE CONTROL HANDLERS ==========

async function handleVoiceControl(interaction) {
    if (!interaction.customId.startsWith('vc_')) return false;
    
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const channelId = parts[2];
    
    const voiceChannel = interaction.guild.channels.cache.get(channelId);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
        await interaction.reply({ content: '❌ Voice channel not found!', ephemeral: true });
        return true;
    }
    
    const channelOwner = userPersonalChannels.get(voiceChannel.id);
    if (channelOwner !== interaction.user.id && !isMod(interaction.member)) {
        await interaction.reply({ content: '❌ You can only control your own personal voice channel!', ephemeral: true });
        return true;
    }
    
    switch(action) {
        case 'lock':
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
            await interaction.reply({ content: '🔒 Voice channel locked!', ephemeral: true });
            break;
            
        case 'unlock':
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: null });
            await interaction.reply({ content: '🔓 Voice channel unlocked!', ephemeral: true });
            break;
            
        case 'hide':
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false });
            await interaction.reply({ content: '👻 Voice channel hidden!', ephemeral: true });
            break;
            
        case 'unhide':
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: null });
            await interaction.reply({ content: '👁️ Voice channel unhidden!', ephemeral: true });
            break;
            
        case 'kick':
            const members = voiceChannel.members.map(m => ({
                label: m.user.username,
                value: m.id,
                description: m.user.tag
            }));
            
            if (members.length === 0) {
                await interaction.reply({ content: '❌ No members to kick!', ephemeral: true });
                break;
            }
            
            const selectRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`vc_kick_select_${channelId}`)
                        .setPlaceholder('Select user to kick')
                        .addOptions(members)
                );
            
            await interaction.reply({ content: 'Select user to kick:', components: [selectRow], ephemeral: true });
            break;
            
        case 'muteall':
            for (const member of voiceChannel.members) {
                await member[1].voice.setMute(true);
            }
            await interaction.reply({ content: '🔇 All members muted!', ephemeral: true });
            break;
            
        case 'unmuteall':
            for (const member of voiceChannel.members) {
                await member[1].voice.setMute(false);
            }
            await interaction.reply({ content: '🔊 All members unmuted!', ephemeral: true });
            break;
            
        case 'rename':
            const modal = new ModalBuilder()
                .setCustomId(`vc_rename_modal_${channelId}`)
                .setTitle('Rename Voice Channel');
            
            const nameInput = new TextInputBuilder()
                .setCustomId('new_name')
                .setLabel('New Channel Name')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter new name...')
                .setRequired(true)
                .setMaxLength(32);
            
            modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
            await interaction.showModal(modal);
            break;
            
        case 'limit':
            const limitModal = new ModalBuilder()
                .setCustomId(`vc_limit_modal_${channelId}`)
                .setTitle('Set User Limit');
            
            const limitInput = new TextInputBuilder()
                .setCustomId('user_limit')
                .setLabel('User Limit (0 = unlimited)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter number (0-99)')
                .setRequired(true);
            
            limitModal.addComponents(new ActionRowBuilder().addComponents(limitInput));
            await interaction.showModal(limitModal);
            break;
            
        case 'transfer':
            const transferMembers = voiceChannel.members.map(m => ({
                label: m.user.username,
                value: m.id,
                description: m.user.tag
            })).filter(m => m.value !== interaction.user.id);
            
            if (transferMembers.length === 0) {
                await interaction.reply({ content: '❌ No other members to transfer ownership to!', ephemeral: true });
                break;
            }
            
            const transferRow = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`vc_transfer_select_${channelId}`)
                        .setPlaceholder('Select new owner')
                        .addOptions(transferMembers)
                );
            
            await interaction.reply({ content: 'Select new owner:', components: [transferRow], ephemeral: true });
            break;
            
        case 'info':
            const owner = await interaction.guild.members.fetch(channelOwner).catch(() => null);
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📊 Voice Channel Info')
                .addFields(
                    { name: '📛 Name', value: voiceChannel.name, inline: true },
                    { name: '👑 Owner', value: owner ? owner.user.username : 'Unknown', inline: true },
                    { name: '👥 Members', value: `${voiceChannel.members.size} / ${voiceChannel.userLimit === 0 ? '∞' : voiceChannel.userLimit}`, inline: true },
                    { name: '🔒 Locked', value: voiceChannel.permissionsFor(interaction.guild.id).has(PermissionsBitField.Flags.Connect) ? 'No' : 'Yes', inline: true },
                    { name: '👁️ Visible', value: voiceChannel.permissionsFor(interaction.guild.id).has(PermissionsBitField.Flags.ViewChannel) ? 'Yes' : 'No', inline: true },
                    { name: '📅 Created', value: `<t:${Math.floor(voiceChannel.createdTimestamp / 1000)}:R>`, inline: true }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
            break;
    }
    
    return true;
}

// ========== MAIN MESSAGE HANDLER ==========
client.on('messageCreate', async (message) => {
    // Handle auto messages for any trigger word
    await handleAutoMessage(message);
    
    if (message.author.bot) return;
    if (!message.content.startsWith('-')) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const { member, guild, channel } = message;
    
    // ========== AI COMMANDS ==========
    if (cmd === 'ai') {
        if (!args.length) {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🤖 AI Chat Command')
                .setDescription('Chat with the AI assistant naturally!')
                .addFields(
                    { name: 'Usage', value: '`-ai <your message>`', inline: false },
                    { name: 'Examples', value: '`-ai slm`\n`-ai labas?`\n`-ai كيف حالك؟`', inline: false },
                    { name: 'Supported Languages', value: '🇲🇦 Darija • 🇸🇦 Arabic • 🇫🇷 French • 🇬🇧 English', inline: false }
                )
                .setTimestamp();
            return message.reply({ embeds: [helpEmbed] });
        }
        const question = args.join(' ');
        await message.channel.sendTyping();
        const response = aiSystem.generateResponse(question, message.author.id);
        return message.reply(response);
    }
    
    if (cmd === 'ask') {
        if (!args.length) {
            return message.reply('❌ Please provide a question!\nExample: `-ask chno had lhaja?`');
        }
        const question = args.join(' ');
        await message.channel.sendTyping();
        const response = aiSystem.generateResponse(question, message.author.id);
        return message.reply(response);
    }
    
    if (cmd === 'iahelp' || cmd === 'aihelp') {
        const stats = aiSystem.getStats();
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🤖 AI Chat System')
            .setDescription('Chat naturally with the AI assistant!')
            .addFields(
                { name: '📝 Commands', value: '`-ai <message>` - Chat naturally\n`-ask <question>` - Ask anything\n`-iahelp` - Show help', inline: false },
                { name: '🌍 Language Support', value: '🇲🇦 Darija • 🇸🇦 Arabic • 🇫🇷 French • 🇬🇧 English', inline: false },
                { name: '📊 Statistics', value: `Active users: ${stats.activeUsers}`, inline: true }
            )
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }
    
    // ========== INVITE COMMANDS ==========

    if (cmd === 'me' && args[0] === 'invite') {
        let targetId = args[1] || message.author.id;
        let targetUser;
        try {
            targetUser = await client.users.fetch(targetId);
        } catch (e) {
            return message.reply('❌ User not found! Please provide a valid user ID.');
        }

        const inviteCount = await getInviteCount(guild.id, targetId);
        const inviteUses = await getInviteUses(guild.id, targetId);

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`📨 Invite Statistics for ${targetUser.tag}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '📊 Total Invites', value: `${inviteCount}`, inline: true },
                { name: '👥 Invited Users (Last 10)', value: inviteUses.length > 0 
                    ? inviteUses.map((u, i) => {
                        const user = client.users.cache.get(u.invitee_id);
                        return `${i+1}. ${user ? user.tag : 'Unknown'} (${new Date(u.joined_at).toLocaleDateString()})`;
                    }).join('\n')
                    : 'No users invited yet.',
                    inline: false }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // ========== AUTO MESSAGE COMMANDS ==========
    
    if (cmd === 'auto' && args[0] === 'mss') {
        if (!isMod(message.member)) {
            return message.reply('❌ Permission denied! You need moderator permissions to use this command.');
        }
        
        const trigger = args[1];
        const response = args.slice(2).join(' ');
        
        if (!trigger || !response) {
            return message.reply('❌ Usage: `-auto mss <trigger_word> <response>`\n\nExample: `-auto mss مرحبا مرحبا بك في سيرفرنا`\n\nWhen someone sends the word "مرحبا", the bot will reply with your message.\n\n📝 **ملاحظة:** الكلمة المشغل يمكن أن تكون أي كلمة (IP، كلمة عادية، رقم، إلخ)');
        }
        
        await saveAutoMessage(guild.id, trigger, response, message.author.id);
        
        const embed = new EmbedBuilder()
            .setColor(0x22C55E)
            .setTitle('✅ Auto Message Set')
            .setDescription(`When someone sends the word **"${trigger}"**, the bot will reply with:\n> ${response}`)
            .addFields(
                { name: 'Trigger Word', value: `\`${trigger}\``, inline: true },
                { name: 'Response', value: response.substring(0, 100) + (response.length > 100 ? '...' : ''), inline: true }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        return;
    }
    
    if (cmd === 'auto' && args[0] === 'list') {
        if (!isMod(message.member)) {
            return message.reply('❌ Permission denied! You need moderator permissions to use this command.');
        }
        
        const autoMessages = await getAllAutoMessages(guild.id);
        
        if (autoMessages.length === 0) {
            return message.reply('❌ No auto messages set in this server! Use `-auto mss <trigger> <response>` to add one.');
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Auto Messages List')
            .setDescription(autoMessages.map((msg, i) => {
                return `${i+1}. **${msg.trigger_word}**\n   → ${msg.response.substring(0, 80)}${msg.response.length > 80 ? '...' : ''}`;
            }).join('\n\n'))
            .setFooter({ text: `Total: ${autoMessages.length} auto messages` })
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        return;
    }
    
    if (cmd === 'auto' && args[0] === 'remove') {
        if (!isMod(message.member)) {
            return message.reply('❌ Permission denied! You need moderator permissions to use this command.');
        }
        
        const trigger = args[1];
        if (!trigger) {
            return message.reply('❌ Usage: `-auto remove <trigger_word>`\nExample: `-auto remove مرحبا`');
        }
        
        await deleteAutoMessage(guild.id, trigger);
        
        const embed = new EmbedBuilder()
            .setColor(0xEF4444)
            .setTitle('🗑️ Auto Message Removed')
            .setDescription(`Auto message for trigger word **${trigger}** has been removed.`)
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        return;
    }
    
    // ========== AUTO VOICE COMMANDS ==========
    
    if (cmd === 'voice' && args[0] === 'add') {
        const channelId = args[1];
        if (!channelId) {
            return message.reply('❌ Usage: `-voice add <voice_channel_id>`\nExample: `-voice add 123456789012345678`');
        }
        
        const voiceChannel = guild.channels.cache.get(channelId);
        if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
            return message.reply('❌ Invalid voice channel ID! Please provide a valid voice channel ID.');
        }
        
        await addAutoVoice(guild.id, message.author.id, channelId);
        const embed = new EmbedBuilder()
            .setColor(0x22C55E)
            .setTitle('✅ Auto-Voice Enabled')
            .setDescription(`You will now auto-create a personal voice channel when joining **${voiceChannel.name}**!`)
            .addFields(
                { name: 'How it works', value: 'When you join that voice channel, a personal VC using your username will be created automatically.', inline: false },
                { name: 'Auto-Delete', value: 'Your personal VC will delete itself when empty.', inline: false },
                { name: 'Control Panel', value: 'Use `-cn ' + channelId + '` in a text channel to open the control panel.', inline: false }
            )
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }
    
    if (cmd === 'cn') {
        const voiceChannelId = args[0];
        if (!voiceChannelId) {
            return message.reply('❌ Usage: `-cn <voice_channel_id>`\nExample: `-cn 123456789012345678`\n\nThis will send the voice control panel to this text channel.');
        }
        
        await sendVoiceControlPanel(message, voiceChannelId);
        return;
    }
    
    // ========== ROLE COMMANDS ==========
    
    if (cmd === 'rol') {
        if (!isMod(message.member)) {
            return message.reply('❌ Permission denied! You need moderator permissions to use this command.');
        }
        
        const roleId = args[0];
        if (!roleId) {
            return message.reply('❌ Usage: `-rol <role_id>`\nExample: `-rol 123456789012345678`\n\nThis will give the specified role to ALL members in the server.');
        }
        
        await message.reply(`🔄 Processing request to assign role to all members... Check your DMs for progress updates.`);
        const result = await assignRoleToAllMembers(guild, roleId, message.author);
        
        if (!result.success) {
            await message.reply(result.message);
        } else {
            await message.reply(`✅ Role assignment completed! Check your DMs for details.`);
        }
        return;
    }
    
    if (cmd === 'norol') {
        if (!isMod(message.member)) {
            return message.reply('❌ Permission denied! You need moderator permissions to use this command.');
        }
        
        const roleId = args[0];
        if (!roleId) {
            return message.reply('❌ Usage: `-norol <role_id>`\nExample: `-norol 123456789012345678`\n\nThis will remove the specified role from ALL members in the server.');
        }
        
        await message.reply(`🔄 Processing request to remove role from all members... Check your DMs for progress updates.`);
        const result = await removeRoleFromAllMembers(guild, roleId, message.author);
        
        if (!result.success) {
            await message.reply(result.message);
        } else {
            await message.reply(`✅ Role removal completed! Check your DMs for details.`);
        }
        return;
    }
    
    // ========== MASS DM COMMAND ==========
    if (cmd === 'mess') {
        if (!isMod(message.member)) {
            return message.reply('❌ Permission denied! You need moderator permissions to use this command.');
        }
        
        const msgText = args.join(' ');
        if (!msgText) {
            return message.reply('❌ Usage: `-mess <message>`\nExample: `-mess Hello everyone! This is an important announcement.`\n\nThis will send the message to ALL members via DM.');
        }
        
        const confirmEmbed = new EmbedBuilder()
            .setColor(0xFF69B4)
            .setTitle('📨 Mass DM Confirmation')
            .setDescription(`⚠️ **WARNING:** This will send a DM to **ALL** members in the server!\n\n**Message:**\n> ${msgText}\n\n**Total recipients:** ${guild.memberCount} members (excluding bots)\n\nClick ✅ to confirm or ❌ to cancel.`)
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('confirm_mess').setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('cancel_mess').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
            );
        
        const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [row] });
        
        const filter = (i) => i.user.id === message.author.id;
        const collector = confirmMsg.createMessageComponentCollector({ filter, time: 30000, max: 1 });
        
        collector.on('collect', async (interaction) => {
            if (interaction.customId === 'confirm_mess') {
                await interaction.deferUpdate();
                await confirmMsg.delete().catch(() => {});
                
                await message.reply(`📨 **Starting mass DM...** Check your DMs for progress updates.`);
                const result = await sendMassDM(message.member, msgText, message.author);
                
                const resultEmbed = new EmbedBuilder()
                    .setColor(0x22C55E)
                    .setTitle('✅ Mass DM Completed!')
                    .setDescription(`📊 **Results:**\n✅ Success: ${result.successCount}\n❌ Failed: ${result.failCount}\n📝 Message: ${msgText.substring(0, 100)}${msgText.length > 100 ? '...' : ''}`)
                    .setTimestamp();
                await message.reply({ embeds: [resultEmbed] });
            } else {
                await interaction.deferUpdate();
                await confirmMsg.delete().catch(() => {});
                await message.reply('❌ Mass DM cancelled.');
            }
        });
        
        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                await confirmMsg.delete().catch(() => {});
                await message.reply('❌ Mass DM creation timed out.');
            }
        });
        
        return;
    }
    
    // ========== KHITAR COMMAND ==========
    if (cmd === 'khtar') {
        const messageId = args[0];
        if (!messageId) {
            return message.reply('❌ Usage: `-khtar <message_id>`\n\nExample: `-khtar 123456789012345678`\n\nThis will randomly pick a winner from all users who reacted to the specified message.');
        }
        
        if (!isMod(message.member)) {
            return message.reply('❌ Permission denied! This command can only be used by moderators.');
        }
        
        await message.reply('🎲 **KHITAR - Selecting a random winner...** 🎲');
        await khtarWinner(message, messageId);
        return;
    }
    
    // ========== GIVEAWAY COMMANDS ==========
    
    if (cmd === 'gv') {
        if (!isMod(message.member)) return message.reply('❌ Permission denied!');
        
        if (args.length < 3) {
            return message.reply('❌ Usage: `-gv <winners> <time> <prize>`\n\nExamples:\n`-gv 2 10m Nitro`\n`-gv 1 1h Steam Gift Card`\n`-gv 5 30d Discord Nitro`\n\nTime format: `s` (seconds), `m` (minutes), `h` (hours), `d` (days)');
        }
        
        const winners = parseInt(args[0]);
        if (isNaN(winners) || winners < 1 || winners > 25) {
            return message.reply('❌ Winners must be a number between 1 and 25!');
        }
        
        const durationStr = args[1];
        const durationMs = parseTime(durationStr);
        if (!durationMs) {
            return message.reply('❌ Invalid time format! Use: `10s`, `5m`, `2h`, `1d`');
        }
        
        const prize = args.slice(2).join(' ');
        if (!prize || prize.length < 1) {
            return message.reply('❌ Please provide a prize name!');
        }
        
        const confirmEmbed = new EmbedBuilder()
            .setColor(0xFF69B4)
            .setTitle('🎉 Create Giveaway?')
            .setDescription(
                `**Prize:** ${prize}\n` +
                `**Winners:** ${winners}\n` +
                `**Duration:** ${fmtTime(durationMs)}\n` +
                `**Channel:** ${channel}\n\n` +
                `Click ✅ to confirm or ❌ to cancel.`
            )
            .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('confirm_giveaway').setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('cancel_giveaway').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
            );
        
        const confirmMsg = await message.reply({ embeds: [confirmEmbed], components: [row] });
        
        const filter = (i) => i.user.id === message.author.id;
        const collector = confirmMsg.createMessageComponentCollector({ filter, time: 30000, max: 1 });
        
        collector.on('collect', async (interaction) => {
            if (interaction.customId === 'confirm_giveaway') {
                await interaction.deferUpdate();
                await confirmMsg.delete().catch(() => {});
                
                const giveawayId = await createGiveaway(channel, winners, durationMs, prize, message.author.toString());
                const successEmbed = new EmbedBuilder()
                    .setColor(0x22C55E)
                    .setTitle('✅ Giveaway Created!')
                    .setDescription(`Giveaway created successfully in ${channel}!\nID: \`${giveawayId.substring(0, 10)}\``)
                    .setTimestamp();
                await message.reply({ embeds: [successEmbed] });
            } else {
                await interaction.deferUpdate();
                await confirmMsg.delete().catch(() => {});
                await message.reply('❌ Giveaway cancelled.');
            }
        });
        
        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                await confirmMsg.delete().catch(() => {});
                await message.reply('❌ Giveaway creation timed out.');
            }
        });
        
        return;
    }
    
    if (cmd === 'giveaways' || cmd === 'glist') {
        if (!isMod(message.member)) return message.reply('❌ Permission denied!');
        
        db.all(`SELECT * FROM giveaways WHERE ended = 0`, [], async (err, rows) => {
            if (err || !rows || rows.length === 0) {
                return message.reply('❌ No active giveaways!');
            }
            
            const embed = new EmbedBuilder()
                .setColor(0xFF69B4)
                .setTitle('🎉 Active Giveaways')
                .setDescription(rows.map(g => {
                    const timeLeft = g.end_time - Date.now();
                    return `**${g.prize}**\n• Winners: ${g.winners}\n• Ends: ${fmtTime(timeLeft)} left\n• ID: \`${g.id.substring(0, 10)}\``;
                }).join('\n\n'))
                .setTimestamp();
            
            await message.reply({ embeds: [embed] });
        });
        return;
    }
    
    if (cmd === 'gend') {
        if (!isMod(message.member)) return message.reply('❌ Permission denied!');
        
        const giveawayId = args[0];
        if (!giveawayId) {
            return message.reply('❌ Usage: `-gend <giveaway_id>`\nUse `-giveaways` to see active giveaway IDs.');
        }
        
        db.all(`SELECT * FROM giveaways WHERE ended = 0 AND id LIKE ?`, [`%${giveawayId}%`], async (err, rows) => {
            if (err || !rows || rows.length === 0) {
                return message.reply('❌ Giveaway not found!');
            }
            
            if (rows.length > 1) {
                return message.reply(`❌ Multiple giveaways found! Please be more specific:\n${rows.map(r => `• ${r.id.substring(0, 10)} - ${r.prize}`).join('\n')}`);
            }
            
            await message.reply(`🎉 Ending giveaway for **${rows[0].prize}**...`);
            await endGiveaway(rows[0].id);
            await message.reply(`✅ Giveaway ended!`);
        });
        return;
    }
    
    // ========== MODERATION COMMANDS ==========
    const modCmds = ['ban', 'kick', 'mute', 'unmute', 'warn', 'clear', 'lock', 'unlock', 'giverole', 'removerole', 'unban', 'ann', 'anni', 'ticketsetup', 'ticket', 'roltest', 'verif', 'sendpanel', 'verifstatus', 'resetverif', 'freegame', 'stopfreegame'];
    if (modCmds.includes(cmd) && !isMod(member)) return message.reply('❌ Permission denied!');
    
    // HELP
    if (cmd === 'help') {
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🛡️ Commands')
            .setDescription('**Prefix:** `-`')
            .addFields(
                { name: '📨 Invite Tracker', value: '`-me invite` - Your invite stats\n`-me invite <user_id>` - Others invite stats', inline: false },
                { name: '📨 Auto Message (Any Word)', value: '`-auto mss <word> <response>` - Set auto response for any word\n`-auto list` - List all auto messages\n`-auto remove <word>` - Remove auto message', inline: false },
                { name: '📨 Mass DM', value: '`-mess <message>` - Send a DM to ALL members in the server', inline: false },
                { name: '🎤 Auto Voice System', value: '`-voice add <channel_id>` - Enable auto personal VC\n`-cn <channel_id>` - Send control panel to this text channel', inline: false },
                { name: '🤖 AI Chat', value: '`-ai <message>` - Chat naturally\n`-ask <question>` - Ask AI\n`-iahelp` - AI help', inline: false },
                { name: '🎉 Giveaways', value: '`-gv <winners> <time> <prize>` - Create giveaway\n`-giveaways` - List active giveaways\n`-gend <id>` - End giveaway\n`-khtar <message_id>` - Pick random winner from message reactions', inline: false },
                { name: '👥 Role Management', value: '`-rol <role_id>` - Give role to ALL members\n`-norol <role_id>` - Remove role from ALL members', inline: false },
                { name: '🎮 Free Games', value: '`-freegame` - Start free games\n`-stopfreegame` - Stop', inline: false },
                { name: 'ℹ️ Info', value: '`-userinfo`, `-serverinfo`, `-avatar`, `-info`', inline: false },
                { name: '📊 Stats', value: '`-rank`, `-top`, `-messages`, `-voice`', inline: false },
                { name: '📢 Announcements', value: '`-ann`, `-anni`', inline: false },
                { name: '🎫 Ticket', value: '`-ticketsetup`, `-ticket`', inline: false },
                { name: '🎭 Reaction Roles', value: '`-roltest`', inline: false },
                { name: '✅ Verification', value: '`-verif`, `-sendpanel`, `-verifstatus`, `-resetverif`', inline: false },
                { name: '🛡️ Moderation', value: '`-ban`, `-kick`, `-mute`, `-unmute`, `-warn`, `-clear`, `-lock`, `-unlock`, `-giverole`, `-removerole`, `-unban`', inline: false }
            )
            .setFooter({ text: '🔒 Anti-Link & Anti-Bot Protection: ACTIVE | 👑 Auto-Role: RE-ADD ON REJOIN' })
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }
    
    // SERVER INFO
    if (cmd === 'serverinfo') {
        const total = guild.memberCount;
        const online = guild.members.cache.filter(m => m.presence?.status === 'online' || m.presence?.status === 'idle' || m.presence?.status === 'dnd').size;
        const voice = guild.members.cache.filter(m => m.voice.channel).size;
        const boosts = guild.premiumSubscriptionCount || 0;
        const level = guild.premiumTier;
        const created = `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`;
        const embed = new EmbedBuilder().setColor(0x5865F2).setAuthor({ name: guild.name, iconURL: guild.iconURL() })
            .setTitle(`📊 SERVER STATISTICS`).setThumbnail(guild.iconURL({ size: 1024 }))
            .addFields(
                { name: '👤 MEMBERS', value: `**${total.toLocaleString()}** Total`, inline: true },
                { name: '🟢 ONLINE', value: `**${online}** Online`, inline: true },
                { name: '🎤 VOICE', value: `**${voice}** In Voice`, inline: true },
                { name: '🚀 BOOSTS', value: `**${boosts}** Boosts (Level ${level})`, inline: true },
                { name: '📅 CREATED', value: `${created}`, inline: true }
            ).setTimestamp();
        await message.reply({ embeds: [embed] });
        return;
    }
    
    // FREE GAMES
    if (cmd === 'freegame') {
        if (activeFreeGameSessions.has(channel.id)) return message.reply('❌ Already running!');
        await message.reply('🎮 Starting free games...');
        const game = await getRandomFreeGame();
        await sendFreeGameEmbed(channel, game);
        const interval = setInterval(async () => {
            const newGame = await getRandomFreeGame();
            await sendFreeGameEmbed(channel, newGame);
        }, 180000);
        activeFreeGameSessions.set(channel.id, interval);
        return;
    }
    
    if (cmd === 'stopfreegame') {
        const interval = activeFreeGameSessions.get(channel.id);
        if (interval) {
            clearInterval(interval);
            activeFreeGameSessions.delete(channel.id);
            message.reply('⏹️ Stopped.');
        } else message.reply('❌ No active session.');
        return;
    }
    
    // STATS
    if (cmd === 'info') {
        let target = member.user;
        if (args[0]) { try { target = await client.users.fetch(args[0]); } catch(e) { return message.reply('❌ User not found'); } }
        const stats = await getUserStats(target.id);
        const allStats = await getAllStats();
        const rank = allStats.findIndex(s => s.user_id === target.id) + 1 || allStats.length + 1;
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`📊 ${target.tag}`).setThumbnail(target.displayAvatarURL())
            .addFields(
                { name: '📈 Level', value: `Level ${stats.level} | Rank #${rank}`, inline: true },
                { name: '💬 Messages', value: `${stats.messages.toLocaleString()}`, inline: true },
                { name: '🎤 Voice', value: `${formatVoiceTime(stats.voice_minutes)}`, inline: true }
            ).setTimestamp();
        await message.reply({ embeds: [embed] });
        return;
    }
    
    if (cmd === 'rank') {
        let target = member.user;
        if (args[0]) { try { target = await client.users.fetch(args[0]); } catch(e) { return message.reply('❌ User not found'); } }
        const stats = await getUserStats(target.id);
        const allStats = await getAllStats();
        const rank = allStats.findIndex(s => s.user_id === target.id) + 1 || allStats.length + 1;
        const xpNeeded = stats.level * 100;
        const progress = Math.floor((stats.xp / xpNeeded) * 100);
        const bar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`🏆 ${target.tag} - #${rank}`)
            .setDescription(`**Level ${stats.level}**\n\`${bar}\` ${progress}%`)
            .addFields({ name: 'XP', value: `${Math.floor(stats.xp)} / ${xpNeeded} XP`, inline: true });
        await message.reply({ embeds: [embed] });
        return;
    }
    
    if (cmd === 'top') {
        const type = args[0] === 'messages' ? 'messages' : (args[0] === 'voice' ? 'voice' : 'xp');
        const allStats = await getAllStats();
        const sorted = [...allStats].sort((a, b) => {
            if (type === 'xp') return b.xp - a.xp;
            if (type === 'messages') return b.messages - a.messages;
            return b.voice_minutes - a.voice_minutes;
        });
        const top10 = sorted.slice(0, 10);
        let desc = '';
        for (let i = 0; i < top10.length; i++) {
            const user = await client.users.fetch(top10[i].user_id).catch(() => null);
            const name = user ? user.username : 'Unknown';
            if (type === 'xp') desc += `${i+1}. **${name}** - Lvl ${top10[i].level}\n`;
            else if (type === 'messages') desc += `${i+1}. **${name}** - ${top10[i].messages.toLocaleString()} msgs\n`;
            else desc += `${i+1}. **${name}** - ${formatVoiceTime(top10[i].voice_minutes)}\n`;
        }
        const titles = { xp: 'XP', messages: 'Messages', voice: 'Voice' };
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`🏆 ${titles[type]} Leaderboard`).setDescription(desc || 'No data');
        await message.reply({ embeds: [embed] });
        return;
    }
    
    if (cmd === 'messages') {
        let target = member.user;
        if (args[0]) { try { target = await client.users.fetch(args[0]); } catch(e) { return message.reply('❌ User not found'); } }
        const stats = await getUserStats(target.id);
        const embed = new EmbedBuilder().setColor(0x57F287).setTitle(`💬 ${target.tag}'s Messages`).setDescription(`**Total:** ${stats.messages.toLocaleString()}`);
        await message.reply({ embeds: [embed] });
        return;
    }
    
    if (cmd === 'voice') {
        let target = member.user;
        if (args[0]) { try { target = await client.users.fetch(args[0]); } catch(e) { return message.reply('❌ User not found'); } }
        const stats = await getUserStats(target.id);
        const embed = new EmbedBuilder().setColor(0xEB459E).setTitle(`🎤 ${target.tag}'s Voice`).setDescription(`**Total:** ${formatVoiceTime(stats.voice_minutes)}`);
        await message.reply({ embeds: [embed] });
        return;
    }
    
    // Other commands
    if (cmd === 'userinfo') {
        const target = args[0] ? await getMember(guild, args[0]) : member;
        if (!target) return message.reply('❌ Not found');
        const warns = await getWarnCount(target.id, guild.id);
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(target.user.tag).setThumbnail(target.user.displayAvatarURL())
            .addFields(
                { name: 'Joined', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
                { name: 'Warnings', value: `${warns}`, inline: true }
            );
        await message.reply({ embeds: [embed] });
        return;
    }
    
    if (cmd === 'avatar') {
        const user = args[0] ? await client.users.fetch(args[0]) : message.author;
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`${user.tag}'s Avatar`).setImage(user.displayAvatarURL({ size: 1024 }));
        await message.reply({ embeds: [embed] });
        return;
    }
    
    if (cmd === 'ann') {
        const text = args.join(' ');
        if (!text) return message.reply('Usage: `-ann <message>`');
        await message.delete();
        await sendAnn(channel, text);
        return;
    }
    
    if (cmd === 'suggest') {
        const sug = args.join(' ');
        if (!sug) return message.reply('Usage: `-suggest <message>`');
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('💡 Suggestion').setDescription(sug).setAuthor({ name: member.user.tag });
        const msg = await channel.send({ embeds: [embed] });
        await msg.react('✅'); await msg.react('❌');
        await message.reply('✅ Submitted!');
        return;
    }
    
    // Moderation commands
    if (cmd === 'ban' && args[0]) {
        const target = await getMember(guild, args[0]);
        if (!target) return message.reply('❌ Not found');
        const reason = args.slice(1).join(' ') || 'No reason';
        await target.ban({ reason });
        await message.reply(`✅ Banned ${target.user.tag}`);
        return;
    }
    
    if (cmd === 'kick' && args[0]) {
        const target = await getMember(guild, args[0]);
        if (!target) return message.reply('❌ Not found');
        const reason = args.slice(1).join(' ') || 'No reason';
        await target.kick(reason);
        await message.reply(`✅ Kicked ${target.user.tag}`);
        return;
    }
    
    if (cmd === 'mute' && args[0] && args[1]) {
        const target = await getMember(guild, args[0]);
        if (!target) return message.reply('❌ Not found');
        const ms = parseTime(args[1]);
        if (!ms) return message.reply('❌ Invalid time');
        const reason = args.slice(2).join(' ') || 'No reason';
        await target.timeout(ms, reason);
        await message.reply(`✅ Muted ${target.user.tag} for ${fmtTime(ms)}`);
        return;
    }
    
    if (cmd === 'unmute' && args[0]) {
        const target = await getMember(guild, args[0]);
        if (!target) return message.reply('❌ Not found');
        await target.timeout(null);
        await message.reply(`✅ Unmuted ${target.user.tag}`);
        return;
    }
    
    if (cmd === 'warn' && args[0]) {
        const target = await getMember(guild, args[0]);
        if (!target) return message.reply('❌ Not found');
        const reason = args.slice(1).join(' ') || 'No reason';
        await addWarning(target.id, guild.id, reason, member.user.tag);
        const count = await getWarnCount(target.id, guild.id);
        await message.reply(`✅ Warned ${target.user.tag} (Total: ${count})`);
        return;
    }
    
    if (cmd === 'clear' && args[0]) {
        const amount = parseInt(args[0]);
        if (!amount || amount < 1 || amount > 100) return message.reply('Usage: `-clear <1-100>`');
        const fetched = await channel.messages.fetch({ limit: amount });
        const deleted = await channel.bulkDelete(fetched);
        const reply = await message.reply(`✅ Deleted ${deleted.size} messages`);
        setTimeout(() => reply.delete(), 3000);
        return;
    }
    
    if (cmd === 'lock') {
        await channel.permissionOverwrites.edit(guild.id, { SendMessages: false });
        message.reply('🔒 Locked');
        return;
    }
    
    if (cmd === 'unlock') {
        await channel.permissionOverwrites.edit(guild.id, { SendMessages: null });
        message.reply('🔓 Unlocked');
        return;
    }
    
    if (cmd === 'giverole' && args[0] && args[1]) {
        const target = await getMember(guild, args[0]);
        const role = guild.roles.cache.get(args[1]);
        if (!target || !role) return message.reply('❌ Not found');
        await target.roles.add(role);
        await message.reply(`✅ Added ${role.name} to ${target.user.tag}`);
        return;
    }
    
    if (cmd === 'removerole' && args[0] && args[1]) {
        const target = await getMember(guild, args[0]);
        const role = guild.roles.cache.get(args[1]);
        if (!target || !role) return message.reply('❌ Not found');
        await target.roles.remove(role);
        await message.reply(`✅ Removed ${role.name} from ${target.user.tag}`);
        return;
    }
    
    if (cmd === 'unban' && args[0]) {
        const user = await client.users.fetch(args[0]).catch(() => null);
        if (!user) return message.reply('❌ Not found');
        await guild.members.unban(user);
        await message.reply(`✅ Unbanned ${user.tag}`);
        return;
    }
    
    // Setup commands
    if (cmd === 'ticketsetup') { await setupTicket(message); return; }
    if (cmd === 'ticket') { 
        const cfg = await getTicketConfig(guild.id);
        if (!cfg) return message.reply('❌ Not configured');
        const pc = guild.channels.cache.get(cfg.panel_channel);
        if (pc) await sendTicketPanel(pc, cfg);
        message.reply(`✅ Panel sent to ${pc}`);
        return;
    }
    if (cmd === 'roltest') { await setupRR(message); return; }
    if (cmd === 'verif') { await setupVerif(message); return; }
    if (cmd === 'sendpanel') {
        const cfg = await getVerif(guild.id);
        if (!cfg) return message.reply('❌ Not configured');
        const ch = guild.channels.cache.get(cfg.channel);
        if (ch) await sendVerifPanel(ch);
        message.reply(`✅ Panel sent`);
        return;
    }
    if (cmd === 'verifstatus') {
        const cfg = await getVerif(guild.id);
        if (!cfg) return message.reply('❌ Not configured');
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Verification Status')
            .addFields(
                { name: 'Auto Role', value: `<@&${cfg.auto_role}>`, inline: true },
                { name: 'Verified Role', value: `<@&${cfg.verified_role}>`, inline: true },
                { name: 'Channel', value: `<#${cfg.channel}>`, inline: true }
            );
        message.reply({ embeds: [embed] });
        return;
    }
    if (cmd === 'resetverif') {
        db.run(`DELETE FROM verification_config WHERE guild_id = ?`, [guild.id]);
        message.reply('✅ Verification config reset');
        return;
    }
    if (cmd === 'anni') {
        await message.delete();
        await sendWelcomeWithImage(message.member);
        return;
    }
});

// ========== ANTI-LINK SYSTEM ==========
client.on('messageCreate', async (message) => {
    if (message.author?.bot || !message.guild) return;
    if (message.content.startsWith('-')) return;
    
    if (LINK_REGEX.test(message.content)) {
        await message.delete().catch(() => {});
        
        const warnEmbed = new EmbedBuilder()
            .setColor(0xEF4444)
            .setTitle('🚫 Links Are Not Allowed')
            .setDescription(`${message.author}, you cannot send links in this server!`)
            .setFooter({ text: 'This rule applies to everyone, including admins.' })
            .setTimestamp();
        
        const warnMsg = await message.channel.send({ embeds: [warnEmbed] });
        setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        
        console.log(`🔗 Link deleted from ${message.author.tag} in ${message.guild.name}`);
        
        const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor(0xEF4444)
                .setTitle('🔗 Link Blocked')
                .addFields(
                    { name: 'User', value: message.author.tag, inline: true },
                    { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                    { name: 'Content', value: message.content.substring(0, 500), inline: false }
                )
                .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }
    }
});

// ========== ANTI-BOT SYSTEM ==========
client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) {
        try {
            await member.ban({ reason: 'Anti-Bot Protection: Bots are not allowed in this server' });
            console.log(`🤖 Banned bot: ${member.user.tag} from ${member.guild.name}`);
            
            const logChannel = member.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setColor(0xEF4444)
                    .setTitle('🤖 Bot Banned')
                    .setDescription(`Bot **${member.user.tag}** was automatically banned from the server.`)
                    .addFields(
                        { name: 'Bot ID', value: member.id, inline: true },
                        { name: 'Reason', value: 'Anti-Bot Protection - Bots are not allowed', inline: true }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error(`Failed to ban bot ${member.user.tag}:`, error.message);
            try {
                await member.kick('Anti-Bot Protection');
                console.log(`🤖 Kicked bot: ${member.user.tag}`);
            } catch (kickError) {
                console.error(`Failed to kick bot:`, kickError.message);
            }
        }
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.user.bot && !newMember.bannable) {
        try {
            await newMember.ban({ reason: 'Anti-Bot Protection' });
            console.log(`🤖 Banned bot (via update): ${newMember.user.tag}`);
        } catch (error) {
            console.error(`Failed to ban bot via update:`, error.message);
        }
    }
});

// ========== AUTO ROLE & WELCOME FOR NEW MEMBERS ==========
client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    await sendWelcomeWithImage(member);
    await processNewMember(member); // <-- Added invite tracking
});

// ========== TRACK MEMBER REMOVAL (for auto role re-add on rejoins) ==========
client.on('guildMemberRemove', async (member) => {
    console.log(`👋 Member left: ${member.user.tag} - Will re-add role if they rejoin`);
});

// Auto Voice System Voice State Handler
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.channelId && !oldState.channelId) {
        const autoVoice = await getAutoVoice(newState.guild.id, newState.member.id);
        if (autoVoice && autoVoice.channel_id === newState.channelId) {
            setTimeout(async () => {
                await createPersonalVoiceChannel(newState.member, newState.channel);
            }, 500);
        }
    }
    
    if (oldState.channelId && !newState.channelId) {
        const channel = oldState.channel;
        if (channel && channel.members.size === 0) {
            if (userPersonalChannels.has(channel.id)) {
                setTimeout(async () => {
                    const freshChannel = oldState.guild.channels.cache.get(channel.id);
                    if (freshChannel && freshChannel.members.size === 0) {
                        userPersonalChannels.delete(channel.id);
                        await freshChannel.delete().catch(console.error);
                        console.log(`🗑️ Deleted empty personal channel: ${freshChannel.name}`);
                    }
                }, 5000);
            }
        }
    }
});

// Voice tracking for stats
client.on('voiceStateUpdate', async (old, neu) => {
    const uid = neu.member?.id || old.member?.id;
    if (!uid) return;
    if (!old.channelId && neu.channelId) voiceStartTimes.set(uid, Date.now());
    else if (old.channelId && !neu.channelId && voiceStartTimes.has(uid)) {
        const mins = Math.floor((Date.now() - voiceStartTimes.get(uid)) / 60000);
        if (mins > 0) await updateVoiceStats(uid, mins);
        voiceStartTimes.delete(uid);
    }
});

// Message stats
client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.guild) return;
    if (msg.content.startsWith('-')) return;
    updateMessageStats(msg.author.id, 1);
});

// Button, Modal, and Select Menu interactions
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && await handleVoiceControl(interaction)) return;
    
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('vc_kick_select_')) {
            const channelId = interaction.customId.replace('vc_kick_select_', '');
            const voiceChannel = interaction.guild.channels.cache.get(channelId);
            const userId = interaction.values[0];
            
            const channelOwner = userPersonalChannels.get(voiceChannel.id);
            if (channelOwner !== interaction.user.id && !isMod(interaction.member)) {
                await interaction.reply({ content: '❌ You can only control your own personal voice channel!', ephemeral: true });
                return;
            }
            
            const member = voiceChannel.members.get(userId);
            if (member) {
                await member.voice.disconnect();
                await interaction.reply({ content: `✅ Kicked ${member.user.username} from the voice channel!`, ephemeral: true });
            } else {
                await interaction.reply({ content: '❌ User not found in voice channel!', ephemeral: true });
            }
            return;
        }
        
        if (interaction.customId.startsWith('vc_transfer_select_')) {
            const channelId = interaction.customId.replace('vc_transfer_select_', '');
            const voiceChannel = interaction.guild.channels.cache.get(channelId);
            const newOwnerId = interaction.values[0];
            
            const channelOwner = userPersonalChannels.get(voiceChannel.id);
            if (channelOwner !== interaction.user.id && !isMod(interaction.member)) {
                await interaction.reply({ content: '❌ You can only transfer your own personal voice channel!', ephemeral: true });
                return;
            }
            
            userPersonalChannels.set(voiceChannel.id, newOwnerId);
            
            await voiceChannel.permissionOverwrites.edit(newOwnerId, {
                ManageChannels: true,
                MuteMembers: true,
                DeafenMembers: true,
                MoveMembers: true
            });
            
            await interaction.reply({ content: `✅ Transferred ownership to <@${newOwnerId}>!`, ephemeral: true });
            return;
        }
    }
    
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('vc_rename_modal_')) {
            const channelId = interaction.customId.replace('vc_rename_modal_', '');
            const voiceChannel = interaction.guild.channels.cache.get(channelId);
            const newName = interaction.fields.getTextInputValue('new_name');
            
            const channelOwner = userPersonalChannels.get(voiceChannel.id);
            if (channelOwner !== interaction.user.id && !isMod(interaction.member)) {
                await interaction.reply({ content: '❌ You can only rename your own personal voice channel!', ephemeral: true });
                return;
            }
            
            await voiceChannel.setName(newName);
            await interaction.reply({ content: `✅ Renamed channel to **${newName}**!`, ephemeral: true });
            return;
        }
        
        if (interaction.customId.startsWith('vc_limit_modal_')) {
            const channelId = interaction.customId.replace('vc_limit_modal_', '');
            const voiceChannel = interaction.guild.channels.cache.get(channelId);
            const limit = parseInt(interaction.fields.getTextInputValue('user_limit'));
            
            if (isNaN(limit) || limit < 0 || limit > 99) {
                await interaction.reply({ content: '❌ Invalid limit! Please enter a number between 0 and 99.', ephemeral: true });
                return;
            }
            
            const channelOwner = userPersonalChannels.get(voiceChannel.id);
            if (channelOwner !== interaction.user.id && !isMod(interaction.member)) {
                await interaction.reply({ content: '❌ You can only set limit for your own personal voice channel!', ephemeral: true });
                return;
            }
            
            await voiceChannel.setUserLimit(limit);
            await interaction.reply({ content: `✅ User limit set to ${limit === 0 ? 'unlimited' : limit}!`, ephemeral: true });
            return;
        }
    }
    
    if (interaction.isButton() && interaction.customId === 'verify_button') {
        const cfg = await getVerif(interaction.guild.id);
        if (!cfg) return interaction.reply({ content: '❌ Not configured', ephemeral: true });
        if (cfg.auto_role && interaction.member.roles.cache.has(cfg.auto_role)) await interaction.member.roles.remove(cfg.auto_role);
        await interaction.member.roles.add(cfg.verified_role);
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('✅ Verified!')], ephemeral: true });
        return;
    }
    
    if (interaction.isButton() && (interaction.customId === 'role_phone' || interaction.customId === 'role_pc')) {
        const roles = await getRR(interaction.guild.id, interaction.message.id);
        const targetEmoji = interaction.customId === 'role_phone' ? '📱' : '💻';
        const role = roles.find(r => r.emoji === targetEmoji);
        if (role) {
            const r = interaction.guild.roles.cache.get(role.role_id);
            if (r) {
                if (interaction.member.roles.cache.has(r.id)) await interaction.member.roles.remove(r);
                else await interaction.member.roles.add(r);
                await interaction.reply({ content: `✅ ${interaction.member.roles.cache.has(r.id) ? 'Removed' : 'Added'} ${r.name}`, ephemeral: true });
            }
        }
        return;
    }
    
    if (interaction.isButton() && interaction.customId === 'create_ticket') {
        const existing = await getTicket(interaction.user.id, interaction.guild.id);
        if (existing) return interaction.reply({ content: `❌ You have a ticket: <#${existing.channel_id}>`, ephemeral: true });
        const cfg = await getTicketConfig(interaction.guild.id);
        if (!cfg?.category) return interaction.reply({ content: '❌ Not configured', ephemeral: true });
        const ch = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: cfg.category,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                ...(cfg.support_role ? [{ id: cfg.support_role, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }] : [])
            ]
        });
        saveTicket(interaction.user.id, ch.id, interaction.guild.id);
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎫 Ticket Created');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Secondary)
        );
        await ch.send({ content: `${interaction.user}`, embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Ticket: ${ch}`, ephemeral: true });
        return;
    }
    
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        if (!isMod(interaction.member)) return interaction.reply({ content: '❌ No permission', ephemeral: true });
        await delTicket(interaction.user.id, interaction.guild.id);
        await interaction.reply('🔒 Closing...');
        setTimeout(() => interaction.channel.delete(), 3000);
        return;
    }
    
    if (interaction.isButton() && interaction.customId === 'claim_ticket') {
        if (!isMod(interaction.member)) return interaction.reply({ content: '❌ No permission', ephemeral: true });
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('🎫 Claimed').setDescription(`${interaction.user} claimed this ticket`)] });
        return;
    }
    
    if (interaction.isButton() && (interaction.customId === 'confirm_giveaway' || interaction.customId === 'cancel_giveaway')) {
        return;
    }
    
    if (interaction.isButton() && (interaction.customId === 'confirm_mess' || interaction.customId === 'cancel_mess')) {
        return;
    }
});

// Ready event
client.once('ready', async () => {
    await loadSentGames();
    await cleanupExpiredGiveaways();
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`🤖 AI Chat System Ready - Natural Darija Support`);
    console.log(`📝 AI Commands: -ai <message> | -ask <question> | -iahelp`);
    console.log(`📨 Invite Tracker: -me invite`);
    console.log(`📨 Auto Message System: -auto mss <any_word> <response>`);
    console.log(`📨 Mass DM Command: -mess <message> - Send DM to ALL members`);
    console.log(`🎉 Giveaway Command: -gv <winners> <time> <prize>`);
    console.log(`🎲 Khitar Command: -khtar <message_id> - Pick random winner from reactions`);
    console.log(`👥 Role Commands:`);
    console.log(`   • -rol <role_id> - Give role to ALL members`);
    console.log(`   • -norol <role_id> - Remove role from ALL members`);
    console.log(`🎤 Auto Voice System:`);
    console.log(`   • -voice add <channel_id> - Enable auto personal VC`);
    console.log(`   • -cn <channel_id> - Send control panel to text channel`);
    console.log(`   • Personal channels use username only (no suffix)`);
    console.log(`🛡️ Protection Systems:`);
    console.log(`   • 🔗 Anti-Link: ALL links are deleted immediately`);
    console.log(`   • 🤖 Anti-Bot: Any bot added is instantly banned`);
    console.log(`🎁 Welcome System:`);
    console.log(`   • Auto Role: ${AUTO_ROLE_ID_FIXED} - Given to every new member`);
    console.log(`   • Auto Role RE-ADD: When members leave and rejoin, they get the role back automatically`);
    console.log(`   • Welcome Channel: ${WELCOME_CHANNEL_ID_FIXED} - Welcome message with image`);
    console.log(`📋 Other Commands: -help for full list`);
    client.user.setActivity('-help for commands', { type: 3 });
    
    // Cache invites for all guilds
    for (const guild of client.guilds.cache.values()) {
        await cacheInvites(guild);
    }
    
    setTimeout(() => joinVoiceChannelProper(), 3000);
});

// Shutdown
async function gracefulShutdown() {
    await saveAllVoiceTime();
    for (const interval of activeFreeGameSessions.values()) clearInterval(interval);
    for (const timeout of activeGiveawayTimeouts.values()) clearTimeout(timeout);
    if (currentVoiceConnection) currentVoiceConnection.destroy();
    db.close(() => process.exit(0));
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('unhandledRejection', (err) => console.error('Error:', err.message));

client.login(BOT_TOKEN);
