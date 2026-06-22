import { spawn, type SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';

export interface StepDef {
  id: string;
  desc: string;
  cmd: string | string[];
  cwd?: string;
  /** shell=true 时 cmd 为完整命令行字符串；shell=false 时 cmd 为 string[] */
  shell?: boolean;
  timeout?: number;
}

export interface StepEvent {
  id: string;
  total: number;
  desc: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  elapsed?: number;
  exitCode?: number;
}

export interface LogEvent {
  stream: 'stdout' | 'stderr';
  text: string;
}

export declare interface Executor {
  on(event: 'step-start', listener: (event: StepEvent) => void): this;
  on(event: 'step-done', listener: (event: StepEvent) => void): this;
  on(event: 'log', listener: (event: LogEvent) => void): this;
  on(event: 'release-done', listener: (result: { status: 'success' | 'failed'; message: string }) => void): this;
}

export class Executor extends EventEmitter {
  history: Array<{ type: string; status: string; message: string; timestamp: string }> = [];

  async runSteps(steps: StepDef[]): Promise<boolean> {
    const total = steps.length;
    let allSuccess = true;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const startTime = Date.now();

      this.emit('step-start', { id: step.id, total, desc: step.desc, status: 'running' });

      const exitCode = await this.runSingleStep(step);

      const elapsed = (Date.now() - startTime) / 1000;
      const status = exitCode === 0 ? 'success' : 'failed';
      this.emit('step-done', { id: step.id, total, desc: step.desc, status, elapsed, exitCode });

      if (exitCode !== 0) {
        allSuccess = false;
        break;
      }
    }

    return allSuccess;
  }

  private runSingleStep(step: StepDef): Promise<number> {
    return new Promise((resolve) => {
      const timeout = step.timeout ?? 120;
      let timedOut = false;

      let cmd: string;
      let args: string[];
      const spawnOptions: SpawnOptions = { cwd: step.cwd, stdio: ['ignore', 'pipe', 'pipe'] };

      if (step.shell) {
        cmd = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
        args = process.platform === 'win32'
          ? ['/d', '/s', '/c', step.cmd as string]
          : ['-c', step.cmd as string];
      } else if (typeof step.cmd === 'string') {
        // 无 shell 时 string cmd 会被 spawn 当成可执行文件路径，用 split 转为数组
        const parts = step.cmd.trim().split(/\s+/);
        cmd = parts[0];
        args = parts.slice(1);
      } else {
        cmd = step.cmd[0];
        args = step.cmd.slice(1);
      }

      const proc = spawn(cmd, args, spawnOptions);

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
        this.emit('log', { stream: 'stderr', text: `\n[超时] 命令执行超过 ${timeout}s，已终止\n` });
        resolve(1);
      }, timeout * 1000);

      // 行缓冲区：解决跨 TCP chunk 的行被截断的问题
      let stdoutBuf = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf-8');
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() || '';
        for (const line of lines) {
          this.emit('log', { stream: 'stdout', text: line + '\n' });
        }
      });

      let stderrBuf = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8');
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop() || '';
        for (const line of lines) {
          this.emit('log', { stream: 'stderr', text: line + '\n' });
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        // 刷新缓冲区剩余内容
        if (stdoutBuf.trim()) this.emit('log', { stream: 'stdout', text: stdoutBuf + '\n' });
        if (stderrBuf.trim()) this.emit('log', { stream: 'stderr', text: stderrBuf + '\n' });
        if (!timedOut) resolve(code ?? 1);
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.emit('log', { stream: 'stderr', text: `\n[错误] ${err.message}\n` });
        resolve(1);
      });
    });
  }

  async runAndReport(type: string, steps: StepDef[]): Promise<boolean> {
    const startTime = new Date().toISOString();
    const success = await this.runSteps(steps);
    const status = success ? 'success' : 'failed';
    this.emit('release-done', { status, message: `${type} ${success ? '完成' : '失败'}` });
    this.history.push({ type, status, message: success ? `${type} 成功` : `${type} 失败`, timestamp: startTime });
    return success;
  }
}
