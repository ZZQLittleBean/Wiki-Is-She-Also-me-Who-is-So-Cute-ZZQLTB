/**
 * GitHub 存储管理器 v2.6
 * 功能：通过GitHub API读取和修改仓库中的Wiki数据
 * 修复：添加空内容检查，防止 JSON 解析错误
 */

(function() {
    'use strict';

    window.WikiGitHubStorage = {
        config: {
            owner: '',
            repo: '',
            branch: 'main',
            dataPath: 'wiki-data',
            token: ''
        },

        init() {
            const savedConfig = localStorage.getItem('wiki_github_config');
            if (savedConfig) {
                try {
                    this.config = JSON.parse(savedConfig);
                    return true;
                } catch (e) {
                    console.warn('[GitHub] 配置解析失败');
                    return false;
                }
            }
            return false;
        },

        isConfigured() {
            return !!(this.config.owner && this.config.repo && this.config.token);
        },

        saveConfig(owner, repo, token, branch = 'main', dataPath = 'wiki-data') {
            this.config = { owner, repo, token, branch, dataPath };
            localStorage.setItem('wiki_github_config', JSON.stringify(this.config));
        },

        clearConfig() {
            this.config = { owner: '', repo: '', branch: 'main', dataPath: 'wiki-data', token: '' };
            localStorage.removeItem('wiki_github_config');
        },

        getBaseUrl() {
            return `https://api.github.com/repos/${this.config.owner}/${this.config.repo}`;
        },

        getHeaders() {
            return {
                'Authorization': `token ${this.config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            };
        },

        // 替换 getFile 方法（正确解码 UTF-8）
        async getFile(path) {
            try {
                const response = await fetch(
                    `${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}?ref=${this.config.branch}`,
                    { headers: this.getHeaders() }
                );

                if (response.status === 404) return null;
                if (!response.ok) throw new Error(`GET ${response.status}`);

                const data = await response.json();
                if (!data.content) return null;

                // 【关键修复】正确解码 Base64 → UTF-8
                const cleanBase64 = data.content.replace(/\s/g, '');
                const binaryString = atob(cleanBase64);
                
                // 将二进制字符串转换为 Uint8Array，再用 TextDecoder 解码为 UTF-8
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const content = new TextDecoder('utf-8').decode(bytes);
                
                return { content, sha: data.sha };
                
            } catch (e) {
                console.error(`[GitHub] getFile ${path}: ${e.message}`);
                return null;
            }
        },

        // 替换 putFile 方法（正确编码 UTF-8）
        async putFile(path, content, message = 'Update via Wiki', isBinary = false, retryCount = 3) {
            let attempt = 0;
            
            while (attempt < retryCount) {
                attempt++;
                
                try {
                    // 获取现有文件 SHA
                    let sha = null;
                    const existing = await this.getFile(path);
                    if (existing && existing.sha) {
                        sha = existing.sha;
                    }

                    let encodedContent;
                    
                    if (isBinary) {
                        // 图片：已经是 base64，清理空白即可
                        encodedContent = content.replace(/\s/g, '');
                    } else {
                        // 【关键修复】正确编码 UTF-8 文本（支持中文）
                        // 步骤1: 使用 TextEncoder 将 UTF-8 字符串转换为 Uint8Array
                        const utf8Bytes = new TextEncoder().encode(content);
                        
                        // 步骤2: 将字节数组转换为二进制字符串（用于 btoa）
                        const binaryString = Array.from(utf8Bytes, byte => String.fromCharCode(byte)).join('');
                        
                        // 步骤3: Base64 编码
                        encodedContent = btoa(binaryString);
                    }

                    const body = {
                        message: message,
                        content: encodedContent,
                        branch: this.config.branch
                    };
                    if (sha) body.sha = sha;

                    const response = await fetch(
                        `${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`,
                        {
                            method: 'PUT',
                            headers: this.getHeaders(),
                            body: JSON.stringify(body)
                        }
                    );

                    if (response.status === 422 || response.status === 409) {
                        const err = await response.json().catch(() => ({}));
                        console.warn(`[GitHub] ${response.status}: ${err.message}，等待后重试...`);
                        await new Promise(r => setTimeout(r, 2000 * attempt));
                        continue;
                    }

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    console.log(`[GitHub] ✅ ${path} 保存成功`);
                    return await response.json();
                    
                } catch (error) {
                    console.error(`[GitHub] 尝试 ${attempt} 失败:`, error.message);
                    if (attempt >= retryCount) throw error;
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                }
            }
            
            throw new Error('超过最大重试次数');
        },

        // 【新增】专门用于保存图片的简化方法
        async saveImage(filename, dataUrl) {
            // 提取 base64 部分
            let base64 = dataUrl;
            if (dataUrl.includes(',')) {
                base64 = dataUrl.split(',')[1];
            }
            
            // 清理并确保格式正确
            base64 = base64.replace(/\s/g, '').trim();
            
            // 图片使用二进制模式（已经是 base64，不要再次编码）
            await this.putFile(`images/${filename}`, base64, `Add image ${filename}`, true);
            return true;
        },
        // 【备选】强制创建新文件（不检查 SHA，用于紧急情况）
        async putFileForceNew(path, content, message = 'Create new file') {
            const body = {
                message: message,
                content: btoa(unescape(encodeURIComponent(content))), // 强制编码
                branch: this.config.branch
                // 故意不写 sha，强制创建
            };
            
            const response = await fetch(
                `${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`,
                {
                    method: 'PUT',
                    headers: this.getHeaders(),
                    body: JSON.stringify(body)
                }
            );
            
            if (!response.ok) {
                throw new Error(`Force create failed: ${response.status}`);
            }
            return response.json();
        },


        async deleteFile(path, message = 'Delete via Wiki') {
            try {
                const existing = await this.getFile(path);
                if (!existing) return true;

                const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`, {
                    method: 'DELETE',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        message: message,
                        sha: existing.sha,
                        branch: this.config.branch
                    })
                });
                if (!response.ok) throw new Error(`GitHub API错误: ${response.status}`);
                return true;
            } catch (error) {
                console.error('[GitHub] 删除文件失败:', error);
                throw error;
            }
        },

        async getDirectory(path = '') {
            try {
                const fullPath = path ? `${this.config.dataPath}/${path}` : this.config.dataPath;
                const response = await fetch(`${this.getBaseUrl()}/contents/${fullPath}?ref=${this.config.branch}`, {
                    method: 'GET',
                    headers: this.getHeaders()
                });
                if (!response.ok) {
                    if (response.status === 404) return [];
                    throw new Error(`GitHub API错误: ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                console.error('[GitHub] 获取目录失败:', error);
                throw error;
            }
        },

        // 【关键修复】添加空内容检查和健壮的错误处理
        async loadWikiData(filename = null) {
            try {
                if (filename) {
                    const file = await this.getFile(filename);
                    // 【修复】检查文件和内容是否存在且不为空
                    if (file && file.content && typeof file.content === 'string' && file.content.trim() !== '') {
                        try {
                            return JSON.parse(file.content);
                        } catch (parseError) {
                            console.warn(`[GitHub] 解析 ${filename} 失败:`, parseError.message);
                            // 【新增】如果解析失败，尝试删除损坏的文件或备份
                            return null;
                        }
                    }
                    return null;
                }

                const filenames = ['data.json', 'wiki-manifest.json'];
                for (const name of filenames) {
                    try {
                        const file = await this.getFile(name);
                        // 【修复】检查文件和内容是否存在且不为空
                        if (file && file.content && typeof file.content === 'string' && file.content.trim() !== '') {
                            try {
                                const parsed = JSON.parse(file.content);
                                // 【关键修复】如果读取的是 wiki-manifest.json 且没有 entries，则跳过（这是映射文件不是数据文件）
                                if (name === 'wiki-manifest.json' && !parsed.entries && !parsed.data && parsed.mappings) {
                                    console.log('[GitHub] 跳过 manifest 文件，继续寻找 data.json');
                                    continue;
                                }
                                console.log('[GitHub] 成功加载数据文件:', name);
                                return parsed;
                            } catch (parseError) {
                                console.warn(`[GitHub] 解析 ${name} 失败:`, parseError.message);
                                continue;
                            }
                        }
                    } catch (e) {
                        console.warn(`[GitHub] 加载 ${name} 失败:`, e.message);
                        continue;
                    }
                }
                return null;
            } catch (error) {
                console.error('[GitHub] 加载Wiki数据失败:', error);
                return null;
            }
        },

        async saveWikiData(data) {
            const content = JSON.stringify(data, null, 2);
            return await this.putFile('data.json', content, 'Update Wiki data');
        },

        async saveImage(filename, dataUrl) {
            try {
                // 提取 base64 部分
                let base64 = dataUrl;
                if (dataUrl.includes(',')) {
                    base64 = dataUrl.split(',')[1];
                }
                
                // 移除 dataUrl 前缀可能残留的空白
                base64 = base64.trim();
                
                // 使用 isBinary=true 模式，避免二次 base64 编码
                await this.putFile(`images/${filename}`, base64, `Add image: ${filename}`, true);
                return true;
            } catch (error) {
                console.error('[GitHub] 保存图片失败:', filename, error.message);
                throw error;
            }
        },

        async loadImage(filename) {
            try {
                // 【新增】处理 {{IMG:filename}} 格式
                if (filename.startsWith('{{IMG:') && filename.endsWith('}}')) {
                    filename = filename.slice(6, -2);
                }
                
                // 检查文件是否存在于GitHub
                const file = await this.getFile(`images/${filename}`);
                if (file) {
                    // 返回 GitHub raw 内容 URL
                    return `https://raw.githubusercontent.com/${this.config.owner}/${this.config.repo}/${this.config.branch}/${this.config.dataPath}/images/${filename}`;
                }
                return null;
            } catch (error) {
                console.error('[GitHub] 加载图片失败:', error);
                return null;
            }
        },

        async getImageList() {
            try {
                const items = await this.getDirectory('images');
                return items.filter(item => item.type === 'file').map(item => item.name);
            } catch (error) {
                console.error('[GitHub] 获取图片列表失败:', error);
                return [];
            }
        },

        async testConnection() {
            try {
                const response = await fetch(`${this.getBaseUrl()}`, {
                    method: 'GET',
                    headers: this.getHeaders()
                });
                if (!response.ok) {
                    if (response.status === 401) return { success: false, error: 'Token无效或已过期' };
                    if (response.status === 404) return { success: false, error: '仓库不存在' };
                    return { success: false, error: `HTTP ${response.status}` };
                }
                const data = await response.json();
                return { success: true, repo: data.name, owner: data.owner.login, private: data.private };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    console.log('GitHub Storage Manager v2.6 加载完成（已修复JSON解析错误）');
})();