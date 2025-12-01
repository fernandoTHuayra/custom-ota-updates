import path from 'path';
import fs from 'fs';

export interface StorageAdapter {
    uploadFile(key: string, buffer: Buffer, contentType: string): Promise<string>;
    getPublicUrl(key: string): string;
}

export class LocalStorageAdapter implements StorageAdapter {
    private readonly publicDir: string;
    private readonly baseUrl: string;

    constructor() {
        this.publicDir = path.join(process.cwd(), 'public', 'updates', 'assets');
        // Assuming server runs on port 3000 by default.
        this.baseUrl =
            process.env.ASSETS_BASE_URL ?? 'http://localhost:3000/updates/assets';

        if (!fs.existsSync(this.publicDir)) {
            fs.mkdirSync(this.publicDir, { recursive: true });
        }
    }

    async uploadFile(
        key: string,
        buffer: Buffer,
        contentType: string
    ): Promise<string> {
        const filePath = path.join(this.publicDir, key);
        fs.writeFileSync(filePath, buffer);
        return this.getPublicUrl(key);
    }

    getPublicUrl(key: string): string {
        return `${this.baseUrl}/${key}`;
    }
}

export const storageAdapter = new LocalStorageAdapter();
