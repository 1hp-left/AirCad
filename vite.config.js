import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    // @mediapipe/tasks-vision ships ESM that needs to stay unbundled for the WASM loader.
    optimizeDeps: {
        exclude: ['@mediapipe/tasks-vision'],
    },
    server: {
        // Cameras require a secure context; Vite dev server is fine on localhost,
        // but allow access from the LAN for phone testing.
        host: true,
    },
});
