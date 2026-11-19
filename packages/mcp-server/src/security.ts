import * as fs from 'fs';
import * as path from 'path';

export interface SafePathOptions {
  allowedExtensions?: string[];
  workspaceRoot?: string;
}

/**
 * Scrub connection strings, credentials, and bearer tokens before returning error payloads to LLM callers.
 */
export function redactSensitiveText(text: string): string {
  return text
    .replace(/\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^:\s]+:[^@\s]+@/gi, '$1://[REDACTED]:[REDACTED]@')
    .replace(/(password|secret|token|api_key)\s*[:=]\s*(['"]?)[^\s'"]+\2/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [REDACTED]');
}

/**
 * Resolve a user-supplied file path safely inside the configured workspace root.
 * Blocks `../` traversal, symlink escapes, and disallowed file extensions.
 */
export function resolveSafeWorkspacePath(userPath: string, options: SafePathOptions = {}): string {
  const rootBase = path.resolve(options.workspaceRoot || process.env.DRIZZLE_SENTINEL_WORKSPACE_ROOT || process.cwd());
  const rootReal = fs.existsSync(rootBase) ? fs.realpathSync(rootBase) : rootBase;

  const resolvedTarget = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(rootReal, userPath);

  const checkPath = fs.existsSync(resolvedTarget) ? fs.realpathSync(resolvedTarget) : resolvedTarget;
  const rel = path.relative(rootReal, checkPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: '${userPath}' escapes workspace root.`);
  }

  if (options.allowedExtensions && options.allowedExtensions.length > 0) {
    const ext = path.extname(checkPath).toLowerCase();
    if (!options.allowedExtensions.includes(ext)) {
      throw new Error(`Unsupported file extension '${ext || '(none)'}': expected ${options.allowedExtensions.join(', ')}.`);
    }
  }

  return checkPath;
}
