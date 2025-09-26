# 🎮 Discord Hangman Bot

A **Discord bot** written in **TypeScript** that brings the classic **Hangman game** to your server.  
Players can guess letters until they find the word — or get "hanged."

---

## ✨ Features
- Classic Hangman gameplay inside Discord chat.
- Multiplayer support.
- Interactive and easy-to-follow messages.
- Built with **TypeScript** for stability and scalability.

---

## 🖼️ Screenshots

![Setup Preview](https://i.postimg.cc/rpWw4Tyq/Screenshot-3.png)  
![Commands Preview](https://i.postimg.cc/1z63FSRR/Screenshot-4.png)  
![Thread Preview](https://i.postimg.cc/qvyPXvnH/Screenshot-6.png)  

---

## ⚙️ How it works

- Any staff member with **KICK permissions** can type `/hangman start` and the game begins.  
- After **15 seconds**, the bot creates a **public thread** and pings your chosen role.  
- The community works together to guess the word.  
- Once the word is guessed, the thread is **auto-deleted after 10 seconds**.  
- After another **15 seconds**, a new round starts automatically.  
- To stop the game, a staff member must use `/hangman stop`.

### Word management
- ➕ Add new words with:  
  `/hangman add category word`
- ➖ Delete words with:  
  `/hangman del category word`

---

## 📦 Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/MateiMihaiG/discord-hangman-bot.git
   cd discord-hangman-bot

2. Install dependencies:

`npm install`

3. Create a .env file in the root folder ( or edit the one I uploaded ):

`DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_guild_id
`

4. Build the TypeScript project:

`npm run build`

5. Start the bot:

`npm start`
