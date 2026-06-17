import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../components/Toast';
import SystemHealth from '../components/SystemHealth';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return { getItem: (k: string) => store[k] || null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; }, clear: () => { store = {}; } };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

function setupToken() {
    const token = btoa(JSON.stringify({ role: 'admin', sub: 'admin', token_version: 1 }));
    localStorageMock.setItem('papacheck_admin_token', `header.${token}.sig`);
}

const mockHealthResponse = {
    snapshot: {
        disk: { usedPercent: 55, totalBytes: 4e10, freeBytes: 1.8e10 },
        memory: { usedPercent: 75, totalBytes: 2e9, freeBytes: 5e8 },
        swap: { usedPercent: 10, totalBytes: 2e9, freeBytes: 1.8e9 },
        postgres: { alive: true, latencyMs: 3 },
        backup: { lastSuccessAt: Date.now() - 3600000, lastStatus: 'success', hoursSinceLastSuccess: 1 },
    },
    events: [],
    cachedAt: Date.now(),
};

describe('SystemHealth', () => {
    beforeEach(() => { vi.clearAllMocks(); localStorageMock.clear(); setupToken(); });

    it('渲染健康状态卡片', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockHealthResponse });
        render(<AuthProvider><ToastProvider><SystemHealth /></ToastProvider></AuthProvider>);
        await waitFor(() => {
            expect(screen.getByText('55%')).toBeDefined();
        });
        expect(screen.getByText('系统健康')).toBeDefined();
    });

    it('备份状态为空时显示暂无备份', async () => {
        const noBackupResponse = { ...mockHealthResponse, snapshot: { ...mockHealthResponse.snapshot, backup: { lastSuccessAt: null, lastStatus: null, hoursSinceLastSuccess: null } } };
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => noBackupResponse });
        render(<AuthProvider><ToastProvider><SystemHealth /></ToastProvider></AuthProvider>);
        await waitFor(() => {
            expect(screen.getByText('暂无备份')).toBeDefined();
        });
    });
});
