<div align="center">

<img src="build/sanook/logo-source/Sanook%20AI%20Icon.jpg" alt="Sanook AI IDE" width="128" height="128" />

# Sanook AI IDE

**An AI‑native code editor built on Code – OSS (Visual Studio Code), crafted in Thailand 🇹🇭**

*โปรแกรมแก้ไขโค้ดที่มี AI ในตัว พัฒนาต่อยอดจาก Code – OSS (Visual Studio Code) — สร้างโดยคนไทย*

[![Based on VS Code](https://img.shields.io/badge/based%20on-VS%20Code%201.125-007ACC?logo=visualstudiocode&logoColor=white)](https://github.com/microsoft/vscode)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE.txt)
[![Marketplace: Open VSX](https://img.shields.io/badge/marketplace-Open%20VSX-c160ef)](https://open-vsx.org)
[![Made in Thailand](https://img.shields.io/badge/made%20in-Thailand%20🇹🇭-ED1C24)](https://www.facebook.com/sanookai)
[![Follow on Facebook](https://img.shields.io/badge/Facebook-Sanook%20AI-1877F2?logo=facebook&logoColor=white)](https://www.facebook.com/sanookai)

</div>

---

## ✨ Overview

**Sanook AI IDE** is a free, open‑source distribution of [Code – OSS](https://github.com/microsoft/vscode) — the open‑source core behind Microsoft Visual Studio Code — re‑imagined as an **AI‑first development environment**. It ships with leading coding assistants built in, uses the vendor‑neutral [Open VSX](https://open-vsx.org) extension registry, and keeps the editing experience you already love, fast and familiar.

> **ภาษาไทย —** Sanook AI IDE คือโปรแกรมแก้ไขโค้ด (code editor) แบบ **โอเพนซอร์สและใช้ฟรี** ที่พัฒนาต่อยอดจาก [Code – OSS](https://github.com/microsoft/vscode) ซึ่งเป็นแกนโอเพนซอร์สของ Microsoft Visual Studio Code โดยปรับให้เป็น **สภาพแวดล้อมเขียนโค้ดที่มี AI เป็นหัวใจหลัก** มีผู้ช่วยเขียนโค้ดชั้นนำติดตั้งมาในตัว ใช้ตลาดส่วนขยายแบบเป็นกลางอย่าง Open VSX และคงประสบการณ์การแก้ไขโค้ดที่เร็วและคุ้นเคยเอาไว้ครบถ้วน

---

## 🤖 Built‑in AI Assistants / ผู้ช่วย AI ในตัว

Sanook AI IDE bundles best‑in‑class AI coding extensions out of the box (darwin‑arm64):

| Extension | Publisher | What it does |
|---|---|---|
| **Claude Code** | Anthropic | Agentic coding assistant — plan, edit across files, run commands, and review changes in the editor. |
| **ChatGPT** | OpenAI | Conversational coding help, explanations, and inline assistance. |

> 📦 The packaged `.vsix` files are distributed via the **[Releases](https://github.com/Sir-chawakorn/Sanook-AI-IDE/releases/latest)** page (they are not stored in the Git repository). Download them into `build/sanook/extensions/` before building. They remain the property of their respective publishers.

> **ภาษาไทย —** ติดตั้งส่วนขยาย AI ระดับแนวหน้ามาให้พร้อมใช้งานทันที ได้แก่ **Claude Code** (Anthropic) ผู้ช่วยเขียนโค้ดแบบ agent ที่วางแผน แก้ไขหลายไฟล์ รันคำสั่ง และตรวจทานโค้ดให้ได้ในตัว และ **ChatGPT** (OpenAI) สำหรับถาม‑ตอบและช่วยอธิบายโค้ด — ไฟล์ `.vsix` ดาวน์โหลดได้จากหน้า [Releases](https://github.com/Sir-chawakorn/Sanook-AI-IDE/releases/latest)

---

## 🎯 Highlights / จุดเด่น

- 🧠 **AI‑first** — top coding assistants are pre‑installed, no setup hunting required.
- 🧩 **Open VSX marketplace** — install extensions from a vendor‑neutral, open registry.
- ⚡ **The VS Code you know** — same editor, debugger, terminal, Git, and extension model.
- 🆓 **Free & open source** — released under the MIT license.
- 🇹🇭 **Built in Thailand** — designed and maintained by a Thai developer, for the local and global dev community.

---

## 🛠️ Building from Source / การ build จากซอร์ส

Sanook AI IDE builds with the same toolchain as VS Code.

**Prerequisites**

- [Node.js](https://nodejs.org) **24.15.0** (see [`.nvmrc`](.nvmrc))
- [Python](https://www.python.org) and platform native build tools (see the VS Code [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute) guide)
- The bundled AI extension `.vsix` files from the [Releases](https://github.com/Sir-chawakorn/Sanook-AI-IDE/releases/latest) page

```bash
# 1) Clone
git clone https://github.com/Sir-chawakorn/Sanook-AI-IDE.git
cd Sanook-AI-IDE

# 2) Install dependencies
npm install

# 3) Download the bundled AI extension .vsix files from the latest Release
#    into build/sanook/extensions/  (distributed via Releases, not stored in Git)
#    → https://github.com/Sir-chawakorn/Sanook-AI-IDE/releases/latest

# 4) Apply the Sanook branding overlay onto product.json
node build/sanook/merge-product.mjs
node build/sanook/strip-proprietary.mjs

# 5) Compile and watch
npm run watch

# 6) Run the editor (in another terminal)
./scripts/code.sh        # macOS / Linux
# scripts\code.bat       # Windows
```

> **ภาษาไทย —** Sanook AI IDE build ด้วยชุดเครื่องมือเดียวกับ VS Code ต้องมี Node.js 24.15.0, Python และเครื่องมือ build ของแต่ละแพลตฟอร์ม ส่วนไฟล์ `.vsix` ของส่วนขยาย AI ให้ดาวน์โหลดจากหน้า [Releases](https://github.com/Sir-chawakorn/Sanook-AI-IDE/releases/latest) มาวางในโฟลเดอร์ `build/sanook/extensions/` แล้วรันตามขั้นตอนด้านบนได้เลย

---

## 🌱 Origin & Attribution / ที่มาและการให้เครดิต

**Sanook AI IDE is a fork of [Code – OSS](https://github.com/microsoft/vscode)**, the open‑source repository where Microsoft and the community develop Visual Studio Code.

- **Upstream project:** [Visual Studio Code (`microsoft/vscode`)](https://github.com/microsoft/vscode) · [code.visualstudio.com](https://code.visualstudio.com)
- **Based on version:** VS Code / Code – OSS `1.125`
- **Upstream license:** [MIT](https://github.com/microsoft/vscode/blob/main/LICENSE.txt) — Copyright © Microsoft Corporation

This project is **not affiliated with, endorsed by, or sponsored by Microsoft**. "Visual Studio Code" and "VS Code" are trademarks of Microsoft. Sanook AI IDE only uses the **open‑source `Code – OSS` codebase** under its MIT license, with its own branding, configuration, and bundled extensions. All credit for the underlying editor goes to Microsoft and the VS Code community. 🙏

> **ภาษาไทย —** Sanook AI IDE เป็น **fork (สำเนาที่พัฒนาต่อ) ของ [Code – OSS](https://github.com/microsoft/vscode)** ซึ่งเป็นซอร์สโค้ดโอเพนซอร์สที่ Microsoft และชุมชนนักพัฒนาใช้สร้าง Visual Studio Code โปรเจกต์นี้ **ไม่ได้มีส่วนเกี่ยวข้อง ไม่ได้รับการรับรอง และไม่ได้สนับสนุนโดย Microsoft** ชื่อ "Visual Studio Code" และ "VS Code" เป็นเครื่องหมายการค้าของ Microsoft — Sanook AI IDE ใช้เพียงโค้ดส่วนโอเพนซอร์ส `Code – OSS` ภายใต้สัญญาอนุญาต MIT พร้อมแบรนด์ การตั้งค่า และส่วนขยายของเราเอง ขอขอบคุณและให้เครดิตแก่ Microsoft และชุมชน VS Code สำหรับแกนของโปรแกรมแก้ไขโค้ดนี้ 🙏

---

## 🇹🇭 Made in Thailand / พัฒนาโดยคนไทย

Sanook AI IDE is **designed and developed by a Thai developer** with ❤️ for the Thai and global developer community.

Follow the project, get updates, and say hi on our Facebook page:

### 👉 [facebook.com/sanookai](https://www.facebook.com/sanookai)

> **ภาษาไทย —** Sanook AI IDE **พัฒนาโดยคนไทย** ด้วยใจรักเพื่อชุมชนนักพัฒนาทั้งในไทยและทั่วโลก ติดตามความเคลื่อนไหว อัปเดตใหม่ ๆ และพูดคุยกับเราได้ที่เพจ Facebook 👉 **[facebook.com/sanookai](https://www.facebook.com/sanookai)** ฝากกดติดตามด้วยนะคะ 🙏

---

## 📄 License / สัญญาอนุญาต

Sanook AI IDE is licensed under the **[MIT License](LICENSE.txt)**.

The underlying `Code – OSS` source code is Copyright © Microsoft Corporation, also under the MIT License. Bundled third‑party extensions (Claude Code by Anthropic, ChatGPT by OpenAI) remain under their respective owners' licenses and terms.

> **ภาษาไทย —** Sanook AI IDE เผยแพร่ภายใต้สัญญาอนุญาต **MIT** ส่วนซอร์สโค้ด `Code – OSS` ที่เป็นฐานนั้นเป็นลิขสิทธิ์ของ Microsoft Corporation ภายใต้ MIT เช่นกัน ส่วนขยายของผู้พัฒนาภายนอกที่แถมมา (Claude Code โดย Anthropic และ ChatGPT โดย OpenAI) ยังคงอยู่ภายใต้สัญญาอนุญาตและเงื่อนไขของเจ้าของแต่ละราย

---

<div align="center">

**Sanook AI IDE** · Built on Code – OSS · Made with ❤️ in Thailand 🇹🇭

[Facebook](https://www.facebook.com/sanookai) · [Upstream: VS Code](https://github.com/microsoft/vscode) · [Open VSX](https://open-vsx.org)

</div>
