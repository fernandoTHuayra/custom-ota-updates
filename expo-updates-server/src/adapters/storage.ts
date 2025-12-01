import fs from 'fs';
import path from 'path';

export interface StorageAdapter {
    uploadFile(key: string, filePath: string, contentType: string): Promise<string>;
    getPublicUrl(key: string): string;
}

export class LocalStorageAdapter implements StorageAdapter {
    private publicDir: string;
    private baseUrl: string;

    constructor() {
        this.publicDir = path.resolve(process.cwd(), 'public/updates/assets');
        // Assuming server runs on port 3000 by default. 
        // In production, this should be an env var.
        this.baseUrl = process.env.ASSETS_BASE_URL || 'http://localhost:3000/updates/assets';

        if (!fs.existsSync(this.publicDir)) {
            fs.mkdirSync(this.publicDir, { recursive: true });
        }
    }

    async uploadFile(key: string, filePath: string, contentType: string): Promise<string> {
        const destPath = path.join(this.publicDir, key);
        fs.copyFileSync(filePath, destPath);
        return this.getPublicUrl(key);
    }

    getPublicUrl(key: string): string {
        return `${this.baseUrl}/${key}`;
    }
}

export const storageAdapter = new LocalStorageAdapter();
