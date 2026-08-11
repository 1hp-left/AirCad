# AirCad

Gesture-controlled 3D modeling with mouse fallbacks, export tools, and an optional voice or text modeling assistant.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Add these two values to `.env` before using the assistant:

```dotenv
OPENROUTER_API_KEY=your_openrouter_key
NVIDIA_API_KEY=your_nvidia_key
```

Open `http://localhost:5173`. The keys remain in the local Node server and are never bundled into the browser app.

## Assistant controls

- Open the text assistant with **View → Assistant panel**.
- Open the separate voice dock with **View → Voice control**.
- Start or stop voice input with **Ctrl + Shift + Space**.
- Undo an applied modeling request with **Ctrl + Z**.

Assistant requests are limited to validated create, select, move, rotate, scale, delete, and combine actions. A multi-action request is applied as one transaction, so a failure restores the previous scene and a successful request can be undone in one step.

## Production build

```powershell
npm run build
npm start
```
