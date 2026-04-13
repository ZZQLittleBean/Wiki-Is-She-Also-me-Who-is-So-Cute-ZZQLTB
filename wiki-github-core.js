/**
 * GitHub版 Wiki 核心系统 v2.0
 * 功能：前后台模式分离，GitHub存储，完整功能支持
 */

// 确保 app 对象存在（与 storage.js 共享同一个对象）
if (typeof window.app === 'undefined') {
    window.app = {};
}

// 扩展 app 对象
Object.assign(window.app, {
    // ========== 应用状态 ==========
    data: {
        entries: [],
        chapters: [],
        camps: [],
        synopsis: [],
        announcements: [],
        currentTimeline: 'latest',
        currentMode: 'view',
        editingId: null,
        editingType: null,
        viewingVersionId: null,
        wikiTitle: '未命名 Wiki',
        wikiSubtitle: '',
        fontFamily: "'Noto Sans SC', sans-serif",
        // 自定义字段支持
        customFields: {},
        // 首页自定义内容
        homeContent: [],
        // 【新增】手动时间轴数据
        timelineNodes: [], // 时间节点列表
        newReaderNodeId: null, // 新读者节点ID
        latestNodeId: null, // 最新时间节点ID
        currentTimelineNode: 'latest' // 当前激活的节点ID，'latest'表示"最新节点"，'all'表示全量
    },
    
    // 运行模式：'backend'(后台/编辑) 或 'frontend'(前台/只读)
    runMode: 'frontend',
    
    // 后台模式登录状态
    backendLoggedIn: false,
    backendPassword: null,
    
    // 分享码验证状态
    shareCodeVerified: false,
    verifiedShareCode: null,
    
    // 临时编辑数据
    tempEntry: null,
    tempVersion: null,
    editingVersionId: null,
    
    // 编辑状态追踪
    editState: {
        originalEntry: null,
        originalVersion: null,
        hasChanges: false,
        undoStack: [],
        redoStack: []
    },

    // ========== 分享码系统 ==========
    shareCodeSystem: {
        // 生成随机分享码
        generateCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 8; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
        },
        
        // 验证分享码格式
        validateCode(code) {
            return /^[A-Z0-9]{8}$/.test(code);
        },
        
        // 验证分享码是否有效
        async verifyCode(code) {
            const codes = await this.loadShareCodes();
            return codes.hasOwnProperty(code);
        },
        
        // 加载所有分享码
        async loadShareCodes() {
            try {
                const content = await window.WikiGitHubStorage.getFile('share-codes.json');
                if (content) {
                    return JSON.parse(content.content);
                }
            } catch (e) {
                console.warn('无法加载分享码列表:', e);
            }
            return {};
        },
        
        // 保存分享码
        async saveShareCode(code, description = '') {
            try {
                const codes = await this.loadShareCodes();
                codes[code] = {
                    description,
                    createdAt: Date.now(),
                    createdBy: window.app.backendLoggedIn ? 'backend' : 'frontend'
                };
                await window.WikiGitHubStorage.putFile('share-codes.json', JSON.stringify(codes, null, 2), 'Add share code');
                return true;
            } catch (e) {
                console.error('保存分享码失败:', e);
                return false;
            }
        },
        
        // 删除分享码
        async deleteCode(code) {
            try {
                const codes = await this.loadShareCodes();
                delete codes[code];
                await window.WikiGitHubStorage.putFile('share-codes.json', JSON.stringify(codes, null, 2), 'Delete share code');
                return true;
            } catch (e) {
                console.error('删除分享码失败:', e);
                return false;
            }
        }
    },

    // ========== 初始化 ==========
    init() {
        // 绑定 GitHub 存储管理器
        this.githubStorage = window.WikiGitHubStorage;
        
        // 初始化存储（加载硬编码配置）
        const hasHardcodedConfig = this.githubStorage.init();
        
        // 检查是否有保存的后台登录状态
        const savedLogin = localStorage.getItem('wiki_backend_login');
        if (savedLogin) {
            try {
                const loginData = JSON.parse(savedLogin);
                if (loginData.expires > Date.now()) {
                    // 恢复Token到配置
                    if (loginData.token) {
                        this.githubStorage.config.token = loginData.token;
                    }
                    this.backendLoggedIn = true;
                    this.runMode = 'backend';
                    
                    if (this.githubStorage.isConfigured()) {
                        this.loadDataFromGitHub();
                        return;
                    }
                } else {
                    localStorage.removeItem('wiki_backend_login');
                }
            } catch (e) {
                localStorage.removeItem('wiki_backend_login');
            }
        }
        // 初始化时间节点
        if (!this.data.timelineNodes) {
            this.data.timelineNodes = [];
        }
        // 确保存在"全量节点"（虚拟节点，不保存在数据中，但在UI中显示）
        this.ensureDefaultNodes();

        // 恢复读者上次选择的时间节点（仅前台模式）
        if (this.runMode === 'frontend') {
            const savedNode = localStorage.getItem('wiki_current_timeline_node');
            if (savedNode) {
                this.data.currentTimelineNode = savedNode;
            } else {
                // 首次访问，默认进入"最新节点"
                this.data.currentTimelineNode = 'latest';
            }
            
            // 检查是否有新读者引导
            const hasSeenGuide = localStorage.getItem('wiki_seen_reader_guide');
            this.data.showNewReaderGuide = !hasSeenGuide && this.data.newReaderNodeId;
        }
        // 【关键修复】只要有硬编码配置，就加载数据（前台模式不需要Token）
        if (hasHardcodedConfig && this.githubStorage.config.owner && this.githubStorage.config.repo) {
            console.log('[Wiki] 使用硬编码配置，正在加载仓库数据...');
            console.log('[Wiki] 当前Token状态:', this.githubStorage.config.token ? '已提供（后台）' : '未提供（前台）');
            
            this.runMode = 'frontend';
            this.backendLoggedIn = false;
            this.loadDataFromGitHub();
        } else {
            console.log('[Wiki] 无GitHub配置，进入本地前台模式');
            this.runMode = 'frontend';
            this.initDefaultData();
            this.updateUIForMode();
            this.router('home');
        }
        
                // 延迟执行自检
        setTimeout(() => this.periodicDataCheck(), 3000);
    },
    
    // 确保默认节点存在
    ensureDefaultNodes() {
        // 【修复2】确保 timelineNodes 始终存在
        if (!this.data.timelineNodes || !Array.isArray(this.data.timelineNodes)) {
            this.data.timelineNodes = [];
        }
        
        // 如果没有设置最新节点，自动选择order最大的节点
        if (!this.data.latestNodeId && this.data.timelineNodes.length > 0) {
            const sorted = [...this.data.timelineNodes].sort((a, b) => b.order - a.order);
            this.data.latestNodeId = sorted[0].id;
        }
        // 如果没有设置新读者节点，默认使用第一个节点
        if (!this.data.newReaderNodeId && this.data.timelineNodes.length > 0) {
            const sorted = [...this.data.timelineNodes].sort((a, b) => a.order - b.order);
            this.data.newReaderNodeId = sorted[0].id;
        }
    },

    // 获取当前应显示的节点ID
    getCurrentNodeId() {
        if (this.data.currentTimelineNode === 'latest') {
            // 【修复7】确保 latestNodeId 有值，否则返回 'all' 避免报错
            return this.data.latestNodeId || 'all';
        }
        return this.data.currentTimelineNode || 'all';
    },

    // 获取当前节点对象
    getCurrentNode() {
        const nodeId = this.getCurrentNodeId();
        if (nodeId === 'all') return null;
        // 【修复】确保 timelineNodes 存在
        if (!this.data.timelineNodes || !Array.isArray(this.data.timelineNodes)) {
            return null;
        }
        return this.data.timelineNodes.find(n => n.id === nodeId);
    },

    // ========== 登录页面 ==========
    // 修改 showLoginPage 函数（约第 175-210 行）- 允许直接进入前台模式
    showLoginPage() {
        const container = document.getElementById('main-container');
        if (!container) return;
        
        const tpl = document.getElementById('tpl-login');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        container.innerHTML = '';
        container.appendChild(clone);
        
        // 【修改】显示登录选项，允许直接进入前台模式
        document.getElementById('login-options').classList.remove('hidden');
        document.getElementById('share-code-form').classList.add('hidden');
        document.getElementById('backend-login-form').classList.add('hidden');
        
        // 绑定前台模式进入按钮
        const frontendBtn = document.getElementById('frontend-login-btn');
        if (frontendBtn) {
            frontendBtn.onclick = () => this.enterFrontendModeDirectly();
        }
    },

    // 【新增】直接进入前台模式（无需分享码）
    enterFrontendModeDirectly() {
        this.runMode = 'frontend';
        this.shareCodeVerified = true; // 标记为已验证，允许访问
        this.showToast('已进入前台模式（只读）', 'success');
        this.router('home');
        this.updateUIForMode();
    },

    // 从主页进入后台登录
    showBackendLoginFromHome() {
        this.showLoginPage();
        setTimeout(() => {
            this.showBackendLogin();
        }, 50);
    },

    // 进入前台模式（分享码登录）
    enterFrontendMode() {
        document.getElementById('login-options').classList.add('hidden');
        document.getElementById('share-code-form').classList.remove('hidden');
    },

    // 显示后台登录
    showBackendLogin() {
        document.getElementById('share-code-form').classList.add('hidden');
        document.getElementById('backend-login-form').classList.remove('hidden');
    },

    // 返回登录选项（返回分享码登录）
    showLoginOptions() {
        document.getElementById('backend-login-form').classList.add('hidden');
        document.getElementById('share-code-form').classList.remove('hidden');
    },

    // 后台模式登录 - 保存配置后永久绑定
    async loginBackend() {
        const owner = document.getElementById('github-owner').value.trim();
        const repo = document.getElementById('github-repo').value.trim();
        const token = document.getElementById('github-token').value.trim();
        const password = document.getElementById('backend-password').value.trim();
        const branch = document.getElementById('github-branch').value.trim() || 'main';
        
        if (!owner || !repo || !token) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请填写GitHub用户名、仓库名称和Token',
                type: 'warning'
            });
            return;
        }
        
        // 保存配置
        this.githubStorage.saveConfig(owner, repo, token, branch);
        
        // 测试连接
        const result = await this.githubStorage.testConnection();
        if (!result.success) {
            this.showAlertDialog({
                title: '连接失败',
                message: result.error || '无法连接到GitHub仓库',
                type: 'error'
            });
            this.githubStorage.clearConfig();
            return;
        }
        
        // 【关键】保存登录状态到localStorage，包含Token
        if (password) {
            this.backendPassword = password;
            localStorage.setItem('wiki_backend_login', JSON.stringify({
                password: password,
                token: token,  // 必须保存Token
                expires: Date.now() + 7 * 24 * 60 * 60 * 1000
            }));
        }
        
        this.backendLoggedIn = true;
        this.runMode = 'backend';
        this.showToast('后台模式登录成功', 'success');
        this.loadDataFromGitHub();
    },

    // 验证分享码（前台模式）
    async verifyShareCode() {
        const input = document.getElementById('share-code-input');
        const code = input.value.trim().toUpperCase();
        
        if (!this.shareCodeSystem.validateCode(code)) {
            this.showAlertDialog({
                title: '格式错误',
                message: '分享码应为8位字母数字组合',
                type: 'warning'
            });
            return;
        }
        
        // 从GitHub获取分享码列表验证
        const isValid = await this.shareCodeSystem.verifyCode(code);
        
        if (isValid) {
            this.shareCodeVerified = true;
            this.verifiedShareCode = code;
            localStorage.setItem('wiki_verified_sharecode', code);
            this.showToast('验证成功', 'success');
            this.loadDataFromGitHub();
        } else {
            this.showAlertDialog({
                title: '验证失败',
                message: '分享码无效或已过期',
                type: 'error'
            });
        }
    },

    // 退出后台模式
    logoutBackend() {
        this.backendLoggedIn = false;
        this.runMode = 'frontend';
        this.backendPassword = null;
        localStorage.removeItem('wiki_backend_login');
        this.showToast('已退出后台模式', 'info');
        this.router('home');
        this.updateUIForMode();
    },

    // 【替换】loadDataFromGitHub - 修复加载逻辑
    async loadDataFromGitHub() {
        try {
            console.log('[Wiki] 开始从GitHub加载数据...');
            
            const file = await this.githubStorage.getFile('data.json');
            if (!file || !file.content) {
                console.log('[Wiki] 仓库中无数据，使用默认值');
                this.initDefaultData();
                this.updateUIForMode();
                console.log('[Wiki] 准备执行自动图片修复...');
                setTimeout(async () => {
                    try {
                        // 步骤 1: 建立引用
                        console.log('[Wiki] 步骤 1: 建立图片引用...');
                        const fixed = await this.autoFixImageReferences();
                        
                        // 步骤 2: 解析 URL（autoFix 内部已调用，这里双重保险）
                        console.log('[Wiki] 步骤 2: 解析图片 URL...');
                        this.resolveImageReferences();
                        
                        // 步骤 3: 深度修复截断（validateAndFixData 已包含此逻辑）
                        console.log('[Wiki] 步骤 3: 数据校验...');
                        const validation = this.validateAndFixData();
                        if (validation.fixed > 0) {
                            console.log(`[Wiki] 校验修复了 ${validation.fixed} 处异常`);
                            // 再次解析
                            this.resolveImageReferences();
                        }
                        
                        // 刷新页面显示
                        this.router(this.data.currentTarget || 'home', false);
                        
                        console.log('[Wiki] ✅ 自动修复流程完成');
                    } catch (e) {
                        console.error('[Wiki] ❌ 自动修复失败:', e);
                    }
                }, 500); // 延迟 500ms 确保 DOM 就绪
                this.router('home');
                return;
            }
            
            let baseData;
            try {
                baseData = JSON.parse(file.content);
            } catch (e) {
                console.error('[Wiki] data.json 解析失败:', e);
                this.showAlertDialog({
                    title: '数据损坏',
                    message: 'data.json 格式错误，可能需要重新导入数据',
                    type: 'error'
                });
                this.initDefaultData();
                return;
            }
            
            console.log('[Wiki] 基础数据加载成功:', baseData.settings?.name || '未命名');
            
            // 【关键】检测分片版本
            let entries = [];
            const isSharded = baseData.version && baseData.version.includes('sharded');
            
            if (isSharded && baseData.entryFiles && baseData.entryFiles.length > 0) {
            console.log('[Wiki] 检测到分片数据，开始加载...');
            try {
                const shardedEntries = await this.loadShardedData(baseData);
                // 【关键保护】只有当分片加载成功且有条目时才使用
                if (shardedEntries && shardedEntries.length > 0) {
                    entries = shardedEntries;
                    console.log('[Wiki] 分片加载成功，条目数:', entries.length);
                } else {
                    console.warn('[Wiki] ⚠️ 分片加载为空，保留已有数据');
                    // 不要覆盖 entries，保持原值
                    if (!entries || entries.length === 0) {
                        entries = [];
                    }
                }
            } catch (e) {
                console.error('[Wiki] 分片加载失败:', e);
                // 【关键保护】分片失败时不清空数据
                if (!entries || entries.length === 0) {
                    entries = this.data?.entries || [];
                }
            }
        } else {
            entries = baseData.entries || [];
            console.log('[Wiki] 使用非分片数据，条目数:', entries.length);
        }
            
            // 【关键】合并数据到 this.data（确保 entries 已赋值）
            this.data = {
                ...this.data,
                settings: baseData.settings || {},
                chapters: baseData.chapters || [],
                camps: baseData.camps || [],
                synopsis: baseData.synopsis || [],
                announcements: baseData.announcements || [],
                homeContent: baseData.homeContent || [],
                customFields: baseData.customFields || {},
                entries: entries  // 确保这行在调用 resolveImageReferences 之前执行
            };
            // 【修复3】确保关键字段存在，防止后续操作报错
            this.data.timelineNodes = this.data.timelineNodes || [];
            this.data.newReaderNodeId = this.data.newReaderNodeId || null;
            this.data.latestNodeId = this.data.latestNodeId || null;
            this.data.currentTimelineNode = this.data.currentTimelineNode || 'latest';

            // 【修复4】导入后立即执行数据修复（内嵌三段控制台代码的功能）
            console.log('[Wiki] 执行导入后数据修复...');
            this.ensureDefaultNodes();  // 确保默认节点
            const validation = this.validateAndFixData();  // 执行截断修复
            if (validation.fixed > 0) {
                console.log(`[Wiki] 导入时自动修复了 ${validation.fixed} 处数据异常`);
            }
            
            console.log('[Wiki] 数据合并完成，条目数:', this.data.entries.length);
            
            // 【关键修复】延迟执行解析，确保数据绑定完成且DOM就绪
            setTimeout(() => {
                this.resolveImageReferences();
                
                // 检查是否仍有未解析的 {{IMG:（表示导入时未建立引用）
                const hasUnresolved = this.data.entries.some(e => 
                    e.versions?.some(v => 
                        JSON.stringify(v).includes('{{IMG:') && 
                        !JSON.stringify(v).includes('raw.githubusercontent.com')
                    )
                );
                
                if (hasUnresolved) {
                    console.warn('[Wiki] 检测到未解析的图片引用，尝试自动修复...');
                    this.autoFixImageReferences();
                }
            }, 100);
            
            // 兼容旧版字段映射
            if (baseData.wikiTitle && !this.data.settings.name) {
                this.data.settings.name = baseData.wikiTitle;
            }
            if (baseData.wikiSubtitle !== undefined && this.data.settings.subtitle === undefined) {
                this.data.settings.subtitle = baseData.wikiSubtitle;
            }
            
            // 【关键修复】确保 githubStorage 已配置且数据已合并后再解析图片
            if (this.githubStorage?.config?.owner && this.data.entries) {
                console.log('[Wiki] 开始解析图片引用...');
                // 使用 setTimeout 确保数据绑定完成（解决某些浏览器的异步问题）
                setTimeout(() => {
                    this.resolveImageReferences();
                    // 解析完成后刷新当前页面以显示图片
                    if (this.data.currentTarget === 'home' || this.data.currentTarget === 'characters') {
                        this.router(this.data.currentTarget || 'home', false);
                    }
                }, 0);
            } else {
                console.warn('[Wiki] 未配置GitHub或无条目数据，跳过图片解析');
            }
            
            // 【关键修复】确保 synopsis 图片也被解析
            if (this.data.synopsis && this.data.synopsis.length > 0) {
                setTimeout(() => this.resolveSynopsisImages(), 100);
            }
            // 【关键】数据合并完成后，确保 entries 存在
            this.data.entries = entries || [];
            
            // 延迟解析图片引用，确保DOM和数据已稳定
            setTimeout(() => {
                this.resolveImageReferences();
                // 如果有图片被解析，刷新当前视图
                this.updateUIForMode();
            }, 100);
            
            this.applyFont();
            this.updateUIForMode();
            this.router('home');
            // 数据合并完成后，确保所有关键字段存在
            this.data.timelineNodes = this.data.timelineNodes || [];
            this.data.newReaderNodeId = this.data.newReaderNodeId || null;
            this.data.latestNodeId = this.data.latestNodeId || null;
            this.data.currentTimelineNode = this.data.currentTimelineNode || 'latest';
            
            // 确保默认节点
            this.ensureDefaultNodes();
            
        } catch (error) {
            console.error('[Wiki] ❌ 加载失败:', error);
            this.showAlertDialog({
                title: '加载失败',
                message: '无法从GitHub加载数据: ' + error.message,
                type: 'error'
            });
            if (!this.data || !this.data.entries) {
                this.initDefaultData();
            }
        }
    },

    // 【新增】专门解析剧情梗概图片
    resolveSynopsisImages() {
        if (!this.githubStorage.config.owner) return;
        
        const { owner, repo, branch, dataPath } = this.githubStorage.config;
        const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dataPath}/images/`;
        
        this.data.synopsis.forEach((syn, idx) => {
            if (syn.image && syn.image.startsWith('{{IMG:')) {
                const filename = syn.image.slice(6, -2);
                syn.image = baseUrl + filename;
                console.log(`[Wiki] 解析Synopsis图片 ${idx}:`, syn.image);
            }
        });
    },

    // 【最终版】图片引用解析 - 自动容错截断和格式错误
    resolveImageReferences() {
        console.log('[Resolve] 开始解析图片引用...');
        
        if (!this.githubStorage?.config?.owner || !this.data?.entries) {
            console.warn('[Resolve] 配置不完整，跳过解析');
            return;
        }
        
        const { owner, repo, branch, dataPath } = this.githubStorage.config;
        const safeDataPath = dataPath || 'wiki-data';
        const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${safeDataPath}/images/`;
        
        let resolved = 0;
        let truncated = 0;
        let errors = [];

        this.data.entries.forEach(entry => {
            if (!entry.versions) return;
            
            entry.versions.forEach(v => {
                // 确保 images 对象存在
                if (!v.images || typeof v.images !== 'object') {
                    v.images = { avatar: null, card: null, cover: null };
                }
                
                ['avatar', 'card', 'cover'].forEach(type => {
                    let val = v.images[type];
                    if (!val || typeof val !== 'string') return;
                    
                    // 场景 1: 已经是完整 URL
                    if (val.startsWith('http')) {
                        // 检查是否截断（.jp 结尾但不是 .jpg）
                        if (val.endsWith('.jp') && !val.endsWith('.jpg')) {
                            v.images[type] = val + 'g';
                            truncated++;
                            console.log(`[Resolve] 修复截断: ${entry.code}.${type}`);
                        }
                        return;
                    }
                    
                    // 场景 2: 解析 {{IMG:filename}} 格式
                    if (val.includes('{{IMG:')) {
                        const match = val.match(/\{\{IMG:\s*([^}]+)\s*\}\}/);
                        if (match && match[1]) {
                            let filename = match[1].trim();
                            
                            // 【关键修复】自动修复截断的扩展名
                            if (filename.endsWith('.jp') && !filename.endsWith('.jpg')) {
                                filename += 'g';
                                truncated++;
                                console.log(`[Resolve] 修复文件名截断: ${filename}`);
                            }
                            if (filename.endsWith('.jpe')) filename += 'g';
                            if (filename.endsWith('.pn')) filename += 'g';
                            
                            // 【关键修复】确保 filename 不包含路径分隔符
                            filename = filename.replace(/.*\//, '');
                            
                            v.images[type] = baseUrl + encodeURIComponent(filename);
                            resolved++;
                        } else {
                            errors.push({entry: entry.code, type, value: val, reason: '格式不匹配'});
                        }
                    }
                });
                
                // 同步旧版 image 字段
                v.image = v.images?.card || v.images?.avatar || v.images?.cover || v.image;
            });
        });

        console.log(`[Resolve] 完成: ${resolved} 个已解析, ${truncated} 个截断已修复`);
        if (errors.length > 0) {
            console.warn('[Resolve] 解析错误:', errors.slice(0, 5)); // 只显示前5个错误
        }
        
        // 如有修复，刷新当前视图
        if (resolved > 0 || truncated > 0) {
            const current = this.data.currentTarget || 'home';
            setTimeout(() => this.router(current, false), 100);
        }
        
        return { resolved, truncated, errors: errors.length };
    },
        // 【长期防护】保存前强制校验，确保所有图片引用格式正确
    validateAndFixData() {
        let fixedCount = 0;
        const issues = [];
        
        this.data.entries.forEach(entry => {
            if (!entry.versions) return;
            
            entry.versions.forEach(v => {
                if (!v.images) v.images = {};
                
                ['avatar', 'card', 'cover'].forEach(type => {
                    let val = v.images[type];
                    if (!val || typeof val !== 'string') return;
                    
                    // 强制检查 {{IMG:...}} 格式内的文件名
                    if (val.includes('{{IMG:')) {
                        const match = val.match(/\{\{IMG:\s*([^\}]+)\}\}/);
                        if (match) {
                            let filename = match[1];
                            
                            // 检测截断并强制修复
                            if (filename.endsWith('.jp') || filename.endsWith('.jpe') || filename.endsWith('.pn')) {
                                console.error(`[DataCheck] 发现截断: ${entry.code}.${type} = ${filename}`);
                                filename = filename + 'g'; // 补全
                                v.images[type] = `{{IMG:${filename}}}`;
                                fixedCount++;
                                issues.push(`${entry.code}.${type}: ${filename}`);
                            }
                            // 检测异常字符
                            else if (filename.includes('?') || filename.includes('&')) {
                                console.error(`[DataCheck] 发现异常字符: ${entry.code}.${type}`);
                                v.images[type] = null; // 清除无效引用
                                fixedCount++;
                            }
                        }
                    }
                });
            });
        });
        
        if (fixedCount > 0) {
            console.warn(`[DataCheck] 共修复 ${fixedCount} 处数据错误:`, issues);
        }
        return { fixed: fixedCount, issues };
    },
        // 【新增】自动修复缺失的图片引用（根据远程图片列表自动补全）
    // 在 wiki-github-core.js 中替换 autoFixImageReferences 方法
    async autoFixImageReferences() {
        try {
            console.log('[AutoFix] 🚀 开始自动修复图片引用...');
            
            if (!this.data?.entries || this.data.entries.length === 0) {
                console.warn('[AutoFix] 暂无条目数据');
                return 0;
            }
            
            // 获取图片列表（带重试）
            let imageList = [];
            for (let i = 0; i < 3; i++) {
                try {
                    imageList = await this.githubStorage.getImageList();
                    if (imageList.length > 0) break;
                    await new Promise(r => setTimeout(r, 1000));
                } catch (e) { /* 忽略 */ }
            }
            
            if (!imageList || imageList.length === 0) {
                console.error('[AutoFix] ❌ 无法获取远程图片列表');
                return 0;
            }
            
            console.log(`[AutoFix] 获取到 ${imageList.length} 个远程图片`);
            
            // 【关键修复】使用与手动代码完全一致的简单匹配逻辑
            const imageSet = new Set(imageList.map(p => p.split('/').pop()));
            
            let fixedCount = 0;
            
            this.data.entries.forEach(entry => {
                if (!entry.versions) return;
                
                entry.versions.forEach(v => {
                    // 确保 images 对象存在（与手动代码一致）
                    if (!v.images || typeof v.images !== 'object') {
                        v.images = { avatar: null, card: null, cover: null };
                    }
                    
                    // 预期的文件名（与手动代码完全一致）
                    const files = {
                        avatar: `${entry.id}_${v.vid}_avatar.jpg`,
                        card: `${entry.id}_${v.vid}_card.jpg`,
                        cover: `${entry.id}_${v.vid}_cover.jpg`
                    };
                    
                    // 检查每个类型（与手动代码一致的简单逻辑）
                    ['avatar', 'card', 'cover'].forEach(type => {
                        const current = v.images[type];
                        
                        // 只有空值、data: 或 blob: 才需要修复（避免覆盖已有 URL）
                        if (!current || current.startsWith('data:') || current.startsWith('blob:')) {
                            if (imageSet.has(files[type])) {
                                v.images[type] = `{{IMG:${files[type]}}`;
                                console.log(`[AutoFix] ✅ ${entry.code} -> ${files[type]}`);
                                fixedCount++;
                            }
                        }
                    });
                    
                    // 同步旧版 image 字段
                    v.image = v.images?.card || v.images?.avatar || v.images?.cover || v.image;
                });
            });
            
            console.log(`[AutoFix] 建立了 ${fixedCount} 个引用`);
            
            if (fixedCount > 0) {
                // 解析为完整 URL
                this.resolveImageReferences();
                
                // 刷新显示
                setTimeout(() => {
                    this.router(this.data.currentTarget || 'home', false);
                }, 100);
                
                // 后台模式自动保存（延迟避免冲突）
                if (this.runMode === 'backend' && this.backendLoggedIn) {
                    setTimeout(async () => {
                        try {
                            await this.saveDataAtomic();
                            console.log('[AutoFix] ✅ 已自动保存到 GitHub');
                        } catch (e) {
                            console.error('[AutoFix] 自动保存失败:', e);
                        }
                    }, 3000);
                }
            } else {
                console.warn('[AutoFix] ⚠️ 未匹配到任何图片，请检查文件名格式');
            }
            
            return fixedCount;
            
        } catch (e) {
            console.error('[AutoFix] 💥 错误:', e);
            return 0;
        }
    },

    // 【完整替换】renderHome 函数 - 修复显示逻辑
    renderHome(container) {
        const tpl = document.getElementById('tpl-home');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        const settings = this.data.settings || {};
        // 【新增】初始化时间轴选择器
        setTimeout(() => this.initTimelineSelector(), 0);
        
        // 【新增】显示/隐藏新读者引导
        const guideEl = document.getElementById('new-reader-guide');
        if (guideEl && this.data.showNewReaderGuide && this.runMode === 'frontend') {
            guideEl.classList.remove('hidden');
        }
        
        const welcomeTitleEl = document.getElementById('welcome-title');
        const welcomeSubtitleEl = document.getElementById('welcome-subtitle');
        
        if (welcomeTitleEl) {
            welcomeTitleEl.textContent = settings.welcomeTitle || '欢迎来到 Wiki';
        }
        if (welcomeSubtitleEl) {
            welcomeSubtitleEl.textContent = settings.welcomeSubtitle || '探索角色、世界观与错综复杂的关系网。';
        }
        
        // 显示/隐藏编辑按钮
        document.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        // 后台入口区域控制
        const backendEntry = document.getElementById('backend-entry-section');
        if (backendEntry) {
            backendEntry.classList.toggle('hidden', this.runMode === 'backend');
        }
        
        // 【关键】确保自定义内容和公告渲染
        this.renderHomeCustomContent();
        this.renderAnnouncementBanner();
        
        // 【删除】移除了不存在的 this.renderHistoryIfExists() 调用
    },
    // 【新增】初始化时间轴下拉选择器
    initTimelineSelector() {
        const selector = document.getElementById('timeline-node-selector');
        if (!selector) return;
        
        // 保留前两个选项（全量、最新）
        selector.innerHTML = `
            <option value="all" ${this.data.currentTimelineNode === 'all' ? 'selected' : ''}>
                📚 全量视图（无剧透保护）
            </option>
            <option value="latest" ${this.data.currentTimelineNode === 'latest' ? 'selected' : ''}>
                🆕 最新进度
            </option>
        `;
        
        // 添加其他节点，按order排序
        const sortedNodes = [...this.data.timelineNodes].sort((a, b) => a.order - b.order);
        sortedNodes.forEach(node => {
            const isNewReader = node.id === this.data.newReaderNodeId;
            const isLatest = node.id === this.data.latestNodeId;
            let label = node.name;
            if (isNewReader) label += ' [起点]';
            if (isLatest) label += ' [当前]';
            
            const option = document.createElement('option');
            option.value = node.id;
            option.textContent = `📖 ${label}`;
            option.selected = this.data.currentTimelineNode === node.id;
            selector.appendChild(option);
        });
    },

    // 【完整替换】renderHomeCustomContent 函数 - 修复前台模式显示
    renderHomeCustomContent() {
        const container = document.getElementById('home-custom-content');
        if (!container) {
            console.warn('[HomeCustom] 找不到容器');
            return;
        }
        
        // 【调试】打印当前数据状态
        console.log('[HomeCustom] 开始渲染:', {
            containerFound: !!container,
            homeContentExists: !!this.data.homeContent,
            homeContentLength: this.data.homeContent?.length,
            mode: this.runMode,
            firstItem: this.data.homeContent?.[0]
        });
        
        container.innerHTML = '';
        
        // 如果数据不存在或为空
        if (!this.data.homeContent || !Array.isArray(this.data.homeContent) || this.data.homeContent.length === 0) {
            console.log('[HomeCustom] 无数据可渲染');
            if (this.runMode === 'backend') {
                container.innerHTML = '<p class="text-gray-400 text-center py-4 text-sm">点击上方按钮添加自定义内容</p>';
            }
            return;
        }
        console.log(`[HomeCustom] 渲染 ${this.data.homeContent.length} 项，模式: ${this.runMode}`);
        
        this.data.homeContent.forEach((item, idx) => {
            if (!item) return;
            
            if (item.type === 'text') {
                const wrapper = document.createElement('div');
                wrapper.className = 'relative group';
                
                if (this.runMode === 'backend') {
                    // 编辑模式：显示可编辑文本框和删除按钮
                    wrapper.innerHTML = `
                        <button onclick="app.removeHomeItem(${idx})" class="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition z-10 bg-white rounded-full w-6 h-6 flex items-center justify-center shadow">
                            <i class="fa-solid fa-times"></i>
                        </button>
                        <textarea class="w-full p-3 border border-gray-200 rounded-lg text-sm min-h-[100px] resize-y focus:ring-2 focus:ring-indigo-500 outline-none" 
                            placeholder="输入文本内容..."
                            onchange="app.updateHomeText(${idx}, this.value)">${item.content || ''}</textarea>
                    `;
                } else {
                    // 【关键】前台模式：显示纯文本内容
                    wrapper.className = 'bg-white p-4 rounded-lg border border-gray-100 shadow-sm';
                    // 使用 white-space: pre-wrap 保留换行
                    wrapper.innerHTML = `<p class="text-gray-700 text-sm leading-relaxed" style="white-space: pre-wrap;">${this.escapeHtml(item.content || '')}</p>`;
                }
                container.appendChild(wrapper);
                
            } else if (item.type === 'entry-ref') {
                const entry = this.data.entries.find(e => e.id === item.entryId);
                if (!entry) {
                    console.warn(`[HomeCustom] 找不到条目: ${item.entryId}`);
                    return;
                }
                
                // 【同步】优先使用定向版本，否则使用当前可见版本
                let version = null;
                if (item.versionId) {
                    version = entry.versions.find(v => v.vid === item.versionId);
                }
                if (!version) {
                    version = this.getVisibleVersion(entry);
                }
                const displayTitle = item.title || version?.title || entry.code;
                
                const div = document.createElement('div');
                div.className = 'bg-indigo-50 p-3 rounded-xl border border-indigo-100 cursor-pointer hover:bg-indigo-100 transition flex items-center gap-3';
                
                // 【同步】如果有指定版本ID，使用定向跳转
                if (item.versionId) {
                    div.onclick = () => this.openEntryWithVersion(entry.id, item.versionId);
                } else {
                    div.onclick = () => this.openEntry(entry.id);
                }
                
                // 【同步】构建徽章HTML（蓝底白字、黄底白字、灰底白字）
                let badgeHtml = '';
                if (item.badgeText && item.badgeClass) {
                    // 确保类名中包含 text-white 以保证白字
                    const badgeClass = item.badgeClass.includes('text-white') ? item.badgeClass : `${item.badgeClass} text-white`;
                    badgeHtml = `<span class="${badgeClass} text-[10px] px-2 py-0.5 rounded font-medium whitespace-nowrap">${item.badgeText}</span>`;
                }
                
                if (this.runMode === 'backend') {
                    div.innerHTML = `
                        <i class="fa-solid fa-book text-indigo-500 shrink-0"></i>
                        <span class="font-medium text-indigo-700 flex-1 truncate">${this.escapeHtml(displayTitle)}</span>
                        ${badgeHtml ? `<div class="ml-auto mr-1">${badgeHtml}</div>` : ''}
                        <button onclick="event.stopPropagation(); app.removeHomeItem(${idx})" class="text-gray-400 hover:text-red-500 w-6 h-6 flex items-center justify-center rounded-full hover:bg-white transition shrink-0">
                            <i class="fa-solid fa-times text-xs"></i>
                        </button>
                    `;
                } else {
                    // 前台模式：简洁显示，保留徽章
                    div.innerHTML = `
                        <i class="fa-solid fa-book text-indigo-500 shrink-0"></i>
                        <span class="font-medium text-indigo-700 truncate">${this.escapeHtml(displayTitle)}</span>
                        ${badgeHtml ? `<div class="ml-auto pl-2">${badgeHtml}</div>` : ''}
                    `;
                }
                container.appendChild(div);
            }
        });
    },

    // 【辅助】HTML转义函数（前台模式需要）
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    // 【新增】数据修复方法
    async repairData() {
        const progress = this.showProgressDialog('修复数据完整性...');
        
        try {
            // 1. 修复缺失的数组
            if (!this.data.entries) this.data.entries = [];
            if (!this.data.chapters) this.data.chapters = [];
            if (!this.data.synopsis) this.data.synopsis = [];
            if (!this.data.announcements) this.data.announcements = [];
            if (!this.data.homeContent) this.data.homeContent = [];
            
            // 2. 同步剧情梗概
            progress.update(30, '同步剧情梗概...');
            this.syncSynopsisWithChapters();
            
            // 3. 清理无效数据
            progress.update(60, '清理无效数据...');
            this.data.entries = this.data.entries.filter(e => e && e.id && e.versions);
            
            // 4. 重新保存
            progress.update(90, '保存修复后的数据...');
            
            progress.close();
            this.showToast('数据修复完成', 'success');
            
            // 重新加载
            await this.loadDataFromGitHub();
            
        } catch (e) {
            progress.close();
            this.showAlertDialog({
                title: '修复失败',
                message: e.message,
                type: 'error'
            });
        }
    },
        // 【长期防护】定期自检，发现截断立即告警并修复
    async periodicDataCheck() {
        // 只在后台模式执行
        if (this.runMode !== 'backend') return;
        
        let truncatedFound = 0;
        
        this.data.entries.forEach(e => {
            e.versions?.forEach(v => {
                ['avatar', 'card', 'cover'].forEach(type => {
                    const val = v.images?.[type];
                    if (typeof val === 'string') {
                        // 检测各种截断模式
                        const isTruncated = 
                            val.endsWith('.jp}}') || 
                            val.endsWith('.jp') && !val.endsWith('.jpg') ||
                            val.includes('.jp/') ||
                            /char-[^_]+_v-\d+_card\.jp[^g]/.test(val); // 正则匹配截断模式
                        
                        if (isTruncated) {
                            console.error(`[PeriodicCheck] 发现截断: ${e.code}.${type} = ${val}`);
                            truncatedFound++;
                        }
                    }
                });
            });
        });
        
        if (truncatedFound > 0) {
            console.warn(`[PeriodicCheck] 发现 ${truncatedFound} 处截断，建议执行修复`);
            // 可选：自动触发修复
            // this.resolveImageReferences();
            // this.saveDataAtomic();
        } else {
            console.log('[PeriodicCheck] 数据完整性检查通过');
        }
    },
    // 替换 initDefaultData 方法 - 增加数据保护
    initDefaultData() {
        // 【关键保护】如果已有数据，不要清空
        if (this.data && this.data.entries && this.data.entries.length > 0) {
            console.log('[Init] 检测到已有数据，跳过初始化');
            return;
        }
        
        console.log('[Init] 执行默认初始化...');
        this.data = {
            entries: [],
            chapters: [],
            camps: ['主角团', '反派', '中立'],
            synopsis: [],
            announcements: [],
            homeContent: [],
            customFields: {},
            currentTimeline: 'latest',
            currentMode: 'view',
            timelineNodes: [],
            newReaderNodeId: null,
            latestNodeId: null,
            currentTimelineNode: 'latest',
            settings: {
                name: '未命名 Wiki',
                subtitle: '',
                welcomeTitle: '欢迎来到 Wiki',
                welcomeSubtitle: '探索角色、世界观与错综复杂的关系网。',
                customFont: null
            }
        };
    },
    // ========== 根据模式更新UI ==========
    updateUIForMode() {
        // 【关键】统一从 settings 读取，增加空值保护
        const settings = this.data.settings || {};
        
        // 左上角工具栏标题
        const headerTitleEl = document.getElementById('wiki-title-display');
        const headerSubEl = document.getElementById('wiki-subtitle-display');
        
        if (headerTitleEl) {
            headerTitleEl.textContent = settings.name || '未命名 Wiki';
        }
        
        // 全局声明（subtitle）
        if (headerSubEl) {
            const subtitle = settings.subtitle || '';
            headerSubEl.textContent = subtitle;
            headerSubEl.classList.toggle('hidden', !subtitle.trim());
        }
        
        // 模式徽章（仅后台模式显示）
        const badge = document.getElementById('mode-badge');
        if (badge) {
            if (this.runMode === 'backend') {
                badge.classList.remove('hidden');
                badge.className = 'mode-badge backend';
                badge.textContent = '后台模式';
            } else {
                badge.classList.add('hidden');
            }
        }
        
        // 显示/隐藏编辑相关元素（保留添加角色/设定/批量导入按钮）
        document.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        // 显示/隐藏模式切换
        const modeSwitch = document.getElementById('mode-switch-container');
        if (modeSwitch) {
            modeSwitch.classList.toggle('hidden', this.runMode !== 'backend');
        }
        
        // 显示/隐藏退出后台按钮
        const logoutBtn = document.getElementById('logout-backend-btn');
        if (logoutBtn) {
            logoutBtn.classList.toggle('hidden', this.runMode !== 'backend');
        }
        // 【新增】主页后台入口区域控制
        const backendEntry = document.getElementById('backend-entry-section');
        if (backendEntry) {
            // 仅在前台模式且未登录时显示
            const shouldShow = this.runMode === 'frontend' && !this.backendLoggedIn;
            backendEntry.classList.toggle('hidden', !shouldShow);
        }
    },
    // 切换时间节点
    switchTimelineNode(nodeId) {
        this.data.currentTimelineNode = nodeId;
        localStorage.setItem('wiki_current_timeline_node', nodeId);
        
        // 刷新当前页面
        const currentTarget = this.data.currentTarget || 'home';
        if (currentTarget === 'characters' || currentTarget === 'non-characters') {
            this.router(currentTarget, false);
        } else {
            this.router('home', false);
        }
        
        const nodeName = nodeId === 'all' ? '全量视图' : 
                        nodeId === 'latest' ? '最新进度' : 
                        this.data.timelineNodes.find(n => n.id === nodeId)?.name || '未知';
        this.showToast(`已切换到：${nodeName}`, 'success');
    },
    // 显示时间轴说明
    showTimelineGuide() {
        this.showAlertDialog({
            title: '时间线系统可以参考这里~',
            message: '• 全量视图：显示所有角色和设定（可能包含剧透）\n• 最新进度：显示故事最新阶段的内容\n• 时间节点：编者预设的特定故事阶段，只显示该阶段已登场的角色\n\n注意：切换时间线不会影响词条内部的版本切换功能哦。',
            type: 'info'
        });
    },
    // 进入新读者模式
    enterNewReaderMode() {
        if (this.data.newReaderNodeId) {
            this.switchTimelineNode(this.data.newReaderNodeId);
            localStorage.setItem('wiki_seen_reader_guide', 'true');
            this.data.showNewReaderGuide = false;
            document.getElementById('new-reader-guide')?.classList.add('hidden');
            this.showToast('已为您切换到起点时间线，避免剧透', 'success');
        }
    },

    // 关闭新读者引导
    dismissReaderGuide() {
        localStorage.setItem('wiki_seen_reader_guide', 'true');
        this.data.showNewReaderGuide = false;
        document.getElementById('new-reader-guide')?.classList.add('hidden');
    },

    // 显示时间轴说明
    showTimelineGuide() {
        this.showAlertDialog({
            title: '时间线系统说明',
            message: '• 全量视图：显示所有角色和设定（可能包含剧透）\n• 最新进度：显示故事最新阶段的内容\n• 时间节点：编者预设的特定故事阶段，只显示该阶段已登场的角色\n\n切换时间线不会影响词条内部的版本切换功能。',
            type: 'info'
        });
    },

    // ========== 页面路由 ==========
    router(target, pushState = true) {
        const container = document.getElementById('main-container');
        if (!container) return;
        // 【新增】如果离开详情页，重置手动版本选择，避免影响其他词条
        if (target !== 'detail' && target !== 'edit') {
            this.data.viewingVersionId = null;
        }
        
        container.innerHTML = '';
        
        // 更新导航状态
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const isActive = btn.dataset.target === target;
            btn.classList.toggle('text-indigo-600', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
        });
        
        // 根据目标渲染不同页面
        switch(target) {
            case 'home':
                this.renderHome(container);
                break;
            case 'characters':
                this.renderList(container, 'character');
                break;
            case 'non-characters':
                this.renderList(container, 'non-character');
                break;
            case 'settings':
                this.renderSettings(container);
                break;
            case 'detail':
                this.renderDetail(container);
                break;
            case 'edit':
                if (this.runMode === 'backend') {
                    this.renderEdit(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('home');
                }
                break;
            case 'synopsis':
                this.renderSynopsis(container);
                break;
            case 'synopsis-edit':
                if (this.runMode === 'backend') {
                    this.renderSynopsisEdit(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('synopsis');
                }
                break;
            case 'graph':
                this.renderGraph(container);
                break;
            case 'timeline-settings':
                if (this.runMode === 'backend') {
                    this.renderTimelineSettings(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('settings');
                }
                break;
            case 'announcement-edit':
                if (this.runMode === 'backend') {
                    this.renderAnnouncementEdit(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('home');
                }
                break;
            case 'timeline-nodes':
                if (this.runMode === 'backend') {
                    this.renderTimelineNodes(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('settings');
                }
                break;
            case 'timeline-node-edit':
                if (this.runMode === 'backend') {
                    this.renderTimelineNodeEdit(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('settings');
                }
                break;
            default:
                this.renderHome(container);
        }
        
        if (pushState) {
            history.pushState({ target }, '', `#${target}`);
        }
    },

    renderList(container, type) {
        // 【修复8】确保时间节点数据存在
        if (!this.data.timelineNodes) {
            this.data.timelineNodes = [];
        }
        if (type === 'non-character') {
            this._injectSettingCardStyles(); // 确保样式注入
            return this.renderSettingsGrouped(container);
        }
        const tpl = document.getElementById('tpl-list');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        const masonry = clone.getElementById('masonry-container');
        const countBadge = clone.getElementById('list-count');
        const title = clone.getElementById('list-title');
        
        title.textContent = type === 'character' ? '角色' : '设定';
        
        // 显示/隐藏编辑按钮
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        // 获取当前时间节点过滤后的条目
        let items = this.getFilteredEntriesByTimeline(type);
        
        if (countBadge) countBadge.textContent = items.length;
        
        if (items.length === 0) {
            const currentNode = this.getCurrentNode();
            if (currentNode && this.runMode === 'frontend') {
                masonry.innerHTML = `
                    <div class="col-span-full text-center py-10">
                        <div class="text-gray-300 mb-3"><i class="fa-solid fa-clock text-4xl"></i></div>
                        <p class="text-gray-500 text-sm">该时间节点暂无${type === 'character' ? '角色' : '设定'}数据</p>
                        <button onclick="app.switchTimelineNode('all')" class="mt-3 text-indigo-600 text-sm hover:underline">
                            查看全量内容
                        </button>
                    </div>
                `;
            } else {
                masonry.innerHTML = '<div class="col-span-full text-center py-10 text-gray-400">暂无数据</div>';
            }
        } else {
            // 按重要程度和置顶排序
            items.sort((a, b) => {
                const aPinned = a.isPinned ? 0 : 1;
                const bPinned = b.isPinned ? 0 : 1;
                if (aPinned !== bPinned) return aPinned - bPinned;
                
                const vA = a.version || this.getVisibleVersion(a.entry || a);
                const vB = b.version || this.getVisibleVersion(b.entry || b);
                return (vA?.level || 5) - (vB?.level || 5);
            });
            
            items.forEach(item => {
                const entry = item.entry || item;
                const version = item.version || this.getVisibleVersion(entry);
                
                if (version) {
                    // 【关键】确保传递布尔值给 isPinned 参数
                    const pinStatus = !!item.isPinned;
                    const card = this.createEntryCard(entry, version, pinStatus);
                    if (card) masonry.appendChild(card);
                }
            });
        }
        
        container.appendChild(clone);
    },
    // ========== 设定栏与目录样式（同步本地版） ==========
    /**
     * 获取设定类型显示标签
     */
    getSettingTypeLabel(type) {
        const labels = {
            'world': '世界设定',
            'document': '特殊文献',
            'art': '绘画/图片',
            'faction': '阵营',
            'custom': '自定义'
        };
        return labels[type] || type;
    },

    /**
     * 获取设定类型图标
     */
    getSettingTypeIcon(type) {
        const icons = {
            'world': 'fa-globe',
            'document': 'fa-scroll',
            'art': 'fa-palette',
            'faction': 'fa-shield-halved',
            'custom': 'fa-folder'
        };
        return icons[type] || 'fa-folder';
    },

    /**
     * 【核心】创建设定卡片（支持无图紧凑模式）
     * @param {Object} entry - 设定词条
     * @param {Object} version - 版本数据
     * @param {Object} options - 配置项 { compact: boolean, isCompactList: boolean }
     */
    createSettingCard(entry, version, options = {}) {
        const { compact = false, isCompactList = false } = options;
        
        const div = document.createElement('div');
        
        // 处理图片引用（适配 GitHub 版 {{IMG:}} 格式）
        let img = version.images?.card || version.images?.avatar || version.image || '';
        if (img && img.startsWith('{{IMG:') && this.githubStorage?.config?.owner) {
            const match = img.match(/\{\{IMG:(.+?)\}\}/);
            if (match) {
                const { owner, repo, branch, dataPath } = this.githubStorage.config;
                img = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dataPath || 'wiki-data'}/images/${encodeURIComponent(match[1])}`;
            }
        }
        const hasImage = img && (img.startsWith('data:') || img.startsWith('blob:') || img.startsWith('http'));
        
        // 标记是否有图，供布局使用
        div.dataset.hasImage = hasImage ? 'true' : 'false';
        
        // 样式类：无图使用 compact 紧凑样式
        let className = 'bg-white rounded-lg border border-gray-200 p-3 cursor-pointer hover:shadow-md transition hover:border-indigo-300 flex flex-col relative group';
        if (!hasImage && compact) {
            className += ' setting-card-compact';
        }
        div.className = className;
        
        // 点击跳转
        div.onclick = () => this.openEntry(entry.id);
        
        // 删除按钮（仅后台模式显示）
        if (this.runMode === 'backend') {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'absolute -top-2 -right-2 w-7 h-7 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg z-20 transition-transform hover:scale-110 border-2 border-white text-xs';
            deleteBtn.title = `删除设定 ${entry.code}`;
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                const confirmed = await this.showConfirmDialog({
                    title: '删除确认',
                    message: `确定删除设定【${version?.title || entry.code}】(${entry.code})？`,
                    confirmText: '删除',
                    cancelText: '取消',
                    type: 'danger'
                });
                if (confirmed) this.deleteEntry(entry.id);
            };
            div.appendChild(deleteBtn);
        }
        
        // 图片区域（有图时显示）
        let imageHtml = '';
        if (hasImage) {
            imageHtml = `
                <div class="aspect-[3/2] bg-gray-100 rounded-lg mb-3 overflow-hidden flex items-center justify-center shrink-0">
                    <img src="${img}" class="w-full h-full object-cover" loading="lazy" 
                        onerror="this.style.display='none'; this.parentElement.innerHTML='<i class=\\'fa-solid fa-image text-gray-300 text-2xl\\'></i>'">
                </div>
            `;
        }
        
        div.innerHTML = `
            ${imageHtml}
            <div class="flex items-center justify-between min-h-[24px] ${!hasImage ? 'mb-1' : ''}">
                <h4 class="font-bold text-sm text-gray-800 truncate flex-1">${version.title || '未命名'}</h4>
                <span class="text-[10px] text-gray-400 font-mono ml-2">${entry.code}</span>
            </div>
            <p class="text-xs text-gray-500 mt-1 line-clamp-2">${version.subtitle || ''}</p>
            ${!hasImage ? '<div class="flex-1"></div>' : ''}
        `;
        
        return div;
    },

    /**
     * 【核心】分组渲染设定列表（主设定栏页面）
     */
    renderSettingsGrouped(container) {
        const tpl = document.getElementById('tpl-list');
        const clone = tpl.content.cloneNode(true);
        
        // 获取容器并修改布局为 Grid（支持无图并排）
        const masonry = clone.querySelector('#masonry-container');
        if (masonry) {
            masonry.innerHTML = '';
            masonry.className = 'max-w-7xl mx-auto pb-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4';
        }
        
        const countBadge = clone.querySelector('#list-count');
        const title = clone.querySelector('#list-title');
        
        if (title) title.textContent = '设定';
        
        container.appendChild(clone);
        
        const wrapper = masonry || container;
        
        // 获取所有设定词条（GitHub 版不过滤 future，不过滤时间轴）
        const settings = this.data.entries.filter(e => e.type === 'non-character');
        if (countBadge) countBadge.textContent = settings.length;
        
        if (settings.length === 0) {
            wrapper.innerHTML = '<div class="col-span-full text-center py-10 text-gray-400">暂无设定数据</div>';
            return;
        }
        
        // 智能分组：自定义目录按 customSettingType 分散归类
        const groups = {};
        const typeOrder = ['world', 'document', 'art', 'faction']; // custom 单独处理
        
        typeOrder.forEach(t => {
            groups[t] = { title: this.getSettingTypeLabel(t), icon: this.getSettingTypeIcon(t), type: t, items: [] };
        });
        
        settings.forEach(entry => {
            let type = entry.settingType || 'world';
            
            // 【关键】自定义目录按名称分散，不再全部塞入"自定义"
            if (type === 'custom' && entry.customSettingType && entry.customSettingType.trim()) {
                const customKey = `custom-${entry.customSettingType.trim()}`;
                if (!groups[customKey]) {
                    groups[customKey] = { 
                        title: entry.customSettingType.trim(), 
                        icon: 'fa-folder-open', 
                        type: 'custom',
                        items: [] 
                    };
                }
                groups[customKey].items.push(entry);
            } else {
                if (!groups[type]) {
                    groups[type] = { title: this.getSettingTypeLabel(type), icon: this.getSettingTypeIcon(type), type: type, items: [] };
                }
                groups[type].items.push(entry);
            }
        });
        
        // 按预设顺序 + 自定义目录排序
        const sortedKeys = [
            ...typeOrder,
            ...Object.keys(groups).filter(k => k.startsWith('custom-')).sort()
        ].filter(key => groups[key] && groups[key].items.length > 0);
        
        // 渲染每个分类
        sortedKeys.forEach(key => {
            const group = groups[key];
            if (!group || group.items.length === 0) return;
            
            // 创建分类区域
            const section = document.createElement('div');
            section.className = 'col-span-full mb-6'; // 标题跨整行
            
            section.innerHTML = `
                <div class="setting-category-header flex justify-between items-center mb-4 pb-2 border-b-2 border-gray-200">
                    <div class="setting-category-title flex items-center gap-2">
                        <i class="fa-solid ${group.icon} text-indigo-600 text-lg"></i>
                        <span class="text-lg font-bold text-gray-800">${group.title}</span>
                        <span class="text-sm font-normal text-gray-500 bg-gray-100 px-3 py-1 rounded-full">${group.items.length}个</span>
                    </div>
                    <button onclick="app.viewSettingCategory('${key}')" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1 px-3 py-1 rounded-lg hover:bg-indigo-50 transition">
                        更多 <i class="fa-solid fa-chevron-right text-xs"></i>
                    </button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" id="setting-group-${key.replace(/[^a-zA-Z0-9]/g, '-')}">
                </div>
            `;
            
            wrapper.appendChild(section);
            
            const grid = section.querySelector(`#setting-group-${key.replace(/[^a-zA-Z0-9]/g, '-')}`);
            
            // 【优化】无图卡片紧凑布局：收集所有卡片，根据是否有图决定布局
            const cardElements = [];
            group.items.forEach(entry => {
                const version = this.getVisibleVersion(entry) || entry.versions?.[0];
                if (!version) return;
                
                const card = this.createSettingCard(entry, version, { compact: true, isCompactList: true });
                cardElements.push({ card, hasImage: card.dataset.hasImage === 'true' });
            });
            
            // 应用布局：两个无图卡片并排（各占 1 格），有图卡片占 1 格但在大屏可能占更多
            cardElements.forEach((item, index) => {
                if (!item.hasImage) {
                    item.card.classList.add('col-span-1');
                    // 如果是连续的无图卡片，让它们自然并排（在 sm:grid-cols-2 下自动并排）
                    if (index % 2 === 0 && cardElements[index + 1] && !cardElements[index + 1].hasImage) {
                        // 标记为可以并排，CSS 已处理
                        item.card.classList.add('setting-card-no-image');
                    }
                } else {
                    // 有图卡片在移动端占1格，在 lg 以上占1格（与无图一致，但内部有图）
                    item.card.classList.add('col-span-1');
                }
                grid.appendChild(item.card);
            });
        });
    },

    /**
     * 查看特定设定分类详情页
     */
    viewSettingCategory(type) {
        const container = document.getElementById('main-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        // 获取该分类下的所有设定
        const settings = this.data.entries.filter(e => {
            if (e.type !== 'non-character') return false;
            if (type.startsWith('custom-') && e.settingType === 'custom') {
                return e.customSettingType === type.replace('custom-', '');
            }
            return e.settingType === type;
        });
        
        if (settings.length === 0) {
            container.innerHTML = `
                <div class="h-full overflow-y-auto p-4 fade-in">
                    <div class="max-w-7xl mx-auto">
                        <button onclick="app.router('non-characters')" class="mb-4 text-gray-600 hover:text-gray-900 flex items-center gap-1 text-sm">
                            <i class="fa-solid fa-arrow-left"></i> 返回设定
                        </button>
                        <div class="text-center py-20 text-gray-400">
                            <i class="fa-solid fa-folder-open text-4xl mb-4 opacity-50"></i>
                            <p>该目录下暂无设定词条</p>
                        </div>
                    </div>
                </div>`;
            return;
        }
        
        // 按标题排序（GitHub 版无时间轴，不区分时间状态）
        const sorted = settings.map(entry => {
            const version = this.getVisibleVersion(entry) || entry.versions[0];
            return { entry, version };
        }).sort((a, b) => (a.version?.title || '').localeCompare(b.version?.title || ''));
        
        // 构建页面
        const wrapper = document.createElement('div');
        wrapper.className = 'h-full overflow-y-auto p-4 fade-in';
        
        const groupTitle = type.startsWith('custom-') ? type.replace('custom-', '') : this.getSettingTypeLabel(type);
        const groupIcon = type.startsWith('custom-') ? 'fa-folder-open' : this.getSettingTypeIcon(type);
        
        wrapper.innerHTML = `
            <div class="max-w-7xl mx-auto mb-6">
                <button onclick="app.router('non-characters')" class="mb-4 text-gray-600 hover:text-gray-900 flex items-center gap-1 text-sm">
                    <i class="fa-solid fa-arrow-left"></i> 返回设定
                </button>
                <h2 class="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <i class="fa-solid ${groupIcon} text-indigo-600"></i>
                    ${groupTitle}
                    <span class="text-sm font-normal text-gray-500 bg-gray-100 px-3 py-1 rounded-full">${sorted.length}个</span>
                </h2>
            </div>
        `;
        
        // 使用 Grid 布局，无图卡片紧凑排列
        const grid = document.createElement('div');
        grid.className = 'max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-20';
        
        // 同样应用无图优化布局
        const cardElements = [];
        sorted.forEach(({ entry, version }) => {
            const card = this.createSettingCard(entry, version, { compact: true });
            cardElements.push({ card, hasImage: card.dataset.hasImage === 'true' });
        });
        
        cardElements.forEach((item, index) => {
            if (!item.hasImage) {
                item.card.classList.add('col-span-1');
                if (index % 2 === 0 && cardElements[index + 1] && !cardElements[index + 1].hasImage) {
                    item.card.classList.add('setting-card-no-image');
                }
            } else {
                item.card.classList.add('col-span-1');
            }
            grid.appendChild(item.card);
        });
        
        wrapper.appendChild(grid);
        container.appendChild(wrapper);
        
        // 注入必要 CSS（确保无图卡片样式）
        this._injectSettingCardStyles();
    },

    /**
     * 注入设定卡片样式（无图优化）
     */
    _injectSettingCardStyles() {
        if (document.getElementById('github-setting-card-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'github-setting-card-styles';
        style.textContent = `
            .setting-card-compact {
                padding: 0.75rem;
                min-height: 80px;
            }
            .setting-card-compact .aspect-\\[3\\/2\\] {
                display: none;
            }
            .setting-card-no-image {
                /* 无图卡片特定样式，如需边框或背景色可在此添加 */
            }
            .setting-category-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 1rem;
                padding-bottom: 0.5rem;
                border-bottom: 2px solid #e5e7eb;
            }
            .setting-category-title {
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }
        `;
        document.head.appendChild(style);
    },

    // 【新增】根据时间轴获取过滤后的条目
    getFilteredEntriesByTimeline(type) {
        const nodeId = this.getCurrentNodeId();
        
        // 全量模式：不过滤
        if (nodeId === 'all' || this.runMode === 'backend') {
            return this.data.entries.filter(e => e.type === type);
        }
        
        const node = this.data.timelineNodes.find(n => n.id === nodeId);
        if (!node || !node.entries) {
            return this.data.entries.filter(e => e.type === type);
        }
        
        // 根据节点entries配置过滤
        const result = [];
        node.entries.forEach(nodeEntry => {
            const entry = this.data.entries.find(e => e.id === nodeEntry.entryId);
            if (entry && entry.type === type) {
                // 找到指定的版本或当前可见版本
                let version = entry.versions.find(v => v.vid === nodeEntry.versionId);
                if (!version) {
                    version = this.getVisibleVersion(entry);
                }
                
                if (version) {
                    result.push({
                        entry: entry,
                        version: version,
                        isPinned: nodeEntry.pinned,
                    });
                }
            }
        });
        
        return result;
    },

    // 【完整替换】renderDetail 函数 - 支持多版本链接索引与完整 Markdown 样式
    renderDetail(container) {
        const entry = this.data.entries.find(e => e.id === this.data.editingId);
        if (!entry) {
            container.innerHTML = '<div class="p-4 text-red-600">条目不存在</div>';
            return;
        }
        
        // 优先使用 viewingVersionId（链接跳转指定），其次获取可见版本
        let version = entry.versions.find(v => v.vid === this.data.viewingVersionId) || 
                    this.getVisibleVersion(entry) || 
                    entry.versions[entry.versions.length - 1];
        
        if (!version) {
            container.innerHTML = '<div class="p-4 text-red-600">该条目没有内容</div>';
            return;
        }
        
        const tpl = document.getElementById('tpl-detail-view');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        clone.getElementById('detail-code').textContent = entry.code;
        
        // 显示/隐藏编辑按钮
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        const contentEl = clone.getElementById('detail-content');
        
        // 构建 GitHub Raw URL 基础路径（用于图片解析）
        let baseUrl = '';
        if (this.githubStorage?.config?.owner) {
            const { owner, repo, branch, dataPath } = this.githubStorage.config;
            const safeDataPath = dataPath || 'wiki-data';
            baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${safeDataPath}/images/`;
        }
        
        // 解析图片 URL（防御性获取）
        let imgUrl = '';
        const rawImg = version.images?.card || version.images?.avatar || version.image || '';
        
        if (typeof rawImg === 'string') {
            if (rawImg.startsWith('http')) {
                imgUrl = rawImg;
            } else if (rawImg.includes('{{IMG:')) {
                const match = rawImg.match(/\{\{IMG:\s*([^}]+)\s*\}\}/);
                if (match && match[1]) {
                    let filename = match[1].trim();
                    // 自动修复截断的扩展名
                    if (filename.endsWith('.jp') && !filename.endsWith('.jpg')) filename += 'g';
                    if (filename.endsWith('.jpe')) filename += 'g';
                    if (filename.endsWith('.pn')) filename += 'g';
                    imgUrl = baseUrl + encodeURIComponent(filename);
                }
            }
        }
        
        if (imgUrl && imgUrl.endsWith('.jp') && !imgUrl.endsWith('.jpg')) {
            imgUrl = imgUrl + 'g';
        }
        
        // 重要程度标签样式
        const level = version.level || 5;
        const levelClass = level <= 2 ? 'bg-amber-100 text-amber-700' : (level === 3 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600');
        
        // 处理题记换行和HTML转义（与正文保持相同逻辑）
        let processedSubtitle = '';
        if (version.subtitle) {
            processedSubtitle = version.subtitle
                .replace(/</g, '&lt;')           // 1. 转义HTML防止XSS
                .replace(/>/g, '&gt;')
                .replace(/&lt;(b|i|u|br)\s*\/?&gt;/g, '<$1>')  // 2. 恢复允许的格式标签
                .replace(/&lt;\/(b|i|u)&gt;/g, '</$1>')
                .replace(/\n/g, '<br>');         // 3. 关键：将换行符转为<br>
        }

        // 渲染内容头部（添加等级标签）
        let contentHtml = `
            <div class="flex flex-col md:flex-row gap-6 mb-6">
                <div class="flex-1">
                    <div class="flex items-center gap-3 mb-3 flex-wrap">
                        <h1 class="text-3xl font-bold text-gray-900">${version.title || '未命名'}</h1>
                        <span class="px-2.5 py-1 rounded-full text-xs font-bold ${levelClass} border border-current opacity-80" title="重要程度等级">
                            Lv.${level}
                        </span>
                    </div>
                    ${processedSubtitle ? `<p class="text-lg italic text-gray-600 border-l-4 border-indigo-300 pl-4" style="white-space: pre-wrap;">${processedSubtitle}</p>` : ''}
                </div>
        `;
        
        if (imgUrl && imgUrl.startsWith('http')) {
            contentHtml += `
                <div class="w-48 shrink-0">
                    <div class="aspect-[3/4] rounded-xl overflow-hidden shadow-lg bg-gray-100 flex items-center justify-center">
                        <img src="${imgUrl}" 
                            class="w-full h-full object-cover" 
                            alt="${version.title || entry.code}" 
                            crossorigin="anonymous"
                            onerror="this.onerror=null; this.style.display='none'; this.parentElement.innerHTML='<div class=\'flex flex-col items-center justify-center w-full h-full bg-gray-50 text-gray-400\'><i class=\'fa-solid fa-image text-4xl mb-2\'></i><span class=\'text-xs\'>图片加载失败</span></div>';">
                    </div>
                </div>
            `;
        }
        
        contentHtml += '</div>';
        
        // 【关键更新】正文块渲染（支持多版本链接、Markdown样式、粗斜体）
        contentHtml += '<div class="prose prose-sm max-w-none">';
        if (version.blocks && version.blocks.length > 0) {
            version.blocks.forEach(block => {
                if (block.type === 'h2') {
                    contentHtml += `<h2 class="text-xl font-bold text-gray-800 mt-8 mb-4 border-b pb-2">${block.text || ''}</h2>`;
                } else if (block.type === 'h3') {
                    contentHtml += `<h3 class="text-lg font-bold text-gray-700 mt-6 mb-3">${block.text || ''}</h3>`;
                } else {
                    let text = block.text || '';
                    
                    // 【核心逻辑】多版本词条链接解析（同步本地版）
                    
                    // 辅助函数：通过ID或Code查找条目
                    const findEntry = (idOrCode) => {
                        if (!idOrCode) return null;
                        const cleanId = String(idOrCode).trim();
                        let entry = this.data.entries.find(e => String(e.id).trim() === cleanId);
                        if (!entry) {
                            entry = this.data.entries.find(e => e.code === cleanId);
                        }
                        return entry;
                    };
                    
                    // 1. 新格式：[[entryId|versionId:displayText]] - 精确指向特定版本
                    text = text.replace(/\[\[([^\]|]+)\|([^:\]]+):([^\]]+)\]\]/g, (match, entryId, versionId, displayText) => {
                        const cleanEntryId = entryId.trim();
                        const cleanVersionId = versionId.trim();
                        const targetEntry = findEntry(cleanEntryId);
                        
                        if (targetEntry && targetEntry.versions) {
                            // 验证版本存在性，不存在则降级到首个版本
                            const targetVersion = targetEntry.versions.find(v => v.vid === cleanVersionId);
                            const actualVid = targetVersion ? targetVersion.vid : (targetEntry.versions[0]?.vid || '');
                            const safeId = String(targetEntry.id).replace(/'/g, "\\'");
                            const safeVid = String(actualVid).replace(/'/g, "\\'");
                            return `<a href="#" class="text-indigo-600 hover:underline font-medium" onclick="app.switchToVersion('${safeId}', '${safeVid}'); return false;">${displayText.trim()}</a>`;
                        }
                        return `<span class="text-red-400" title="词条未找到">[[${displayText.trim()}]]</span>`;
                    });
                    
                    // 2. 旧格式：[[entryIdOrCode:displayText]] - 指向首个版本（确保链接稳定）
                    text = text.replace(/\[\[([^\]|]+):([^\]]+)\]\]/g, (match, entryIdOrCode, displayText) => {
                        const cleanId = entryIdOrCode.trim();
                        const targetEntry = findEntry(cleanId);
                        
                        if (targetEntry && targetEntry.versions && targetEntry.versions.length > 0) {
                            // 【关键】指向首个版本（最旧），确保新增版本后链接不变
                            const firstVersion = targetEntry.versions[0];
                            const safeId = String(targetEntry.id).replace(/'/g, "\\'");
                            const safeVid = String(firstVersion.vid).replace(/'/g, "\\'");
                            return `<a href="#" class="text-indigo-600 hover:underline font-medium" onclick="app.switchToVersion('${safeId}', '${safeVid}'); return false;">${displayText.trim()}</a>`;
                        }
                        return `<span class="text-red-400" title="词条未找到">[[${displayText.trim()}]]</span>`;
                    });
                    
                    // 3. 旧格式兼容：[[title]] - 通过标题查找
                    text = text.replace(/\[\[(.*?)\]\]/g, (match, title) => {
                        // 排除已处理的新格式（包含|或:）
                        if (match.includes('|') || match.includes(':')) return match;
                        
                        const cleanTitle = title.trim();
                        const targetEntry = this.data.entries.find(e => {
                            const v = this.getVisibleVersion(e);
                            return v && v.title === cleanTitle;
                        });
                        
                        if (targetEntry && targetEntry.versions.length > 0) {
                            const firstVersion = targetEntry.versions[0];
                            const safeId = String(targetEntry.id).replace(/'/g, "\\'");
                            const safeVid = String(firstVersion.vid).replace(/'/g, "\\'");
                            return `<a href="#" class="text-indigo-600 hover:underline font-medium" onclick="app.switchToVersion('${safeId}', '${safeVid}'); return false;">${cleanTitle}</a>`;
                        }
                        return `<span class="text-gray-400">[[${cleanTitle}]]</span>`;
                    });
                    
                    // 4. 角色引用：@姓名[编号] -> 蓝色标签（与本地版一致）
                    text = text.replace(/@([^\[]+)\[([^\]]+)\]/g, (match, name, code) => {
                        const cleanCode = code.replace(/\\/g, '');
                        return `<span class="synopsis-entry-ref cursor-pointer text-indigo-600 font-medium border-b-2 border-indigo-300 hover:bg-indigo-50 px-1 rounded transition" data-entry-code="${cleanCode}" onmouseenter="app.handleSynopsisRefHover(this)" onmouseleave="app.handleSynopsisRefLeave(this)" onclick="app.openEntryByCode('${cleanCode}')"><i class="fa-solid fa-user text-xs mr-1"></i>${name}</span>`;
                    });

                    // 5. 剧情引用：{{synopsis:id:title}} -> 蓝色标签（与本地版一致）
                    text = text.replace(/\{\{synopsis:([^:]+):([^}]+)\}\}/g, (match, chapterId, title) => {
                        const chapter = this.data.synopsis.find(s => s.id === chapterId);
                        if (!chapter) return match;
                        return `<span class="synopsis-entry-ref cursor-pointer text-indigo-600 font-medium border-b-2 border-indigo-300 hover:bg-indigo-50 px-1 rounded transition" data-chapter-id="${chapterId}" onmouseenter="app.handleSynopsisRefHover(this)" onmouseleave="app.handleSynopsisRefLeave(this)" onclick="app.handleSynopsisRefClick(this)"><i class="fa-solid fa-film text-xs mr-1"></i>${title}</span>`;
                    });

                    // 【样式解析】Markdown 与 HTML 样式处理（与本地版兼容）
                    
                    // 注意：以下顺序很重要，先处理复杂组合，再处理简单标记
                    
                    // 6. 删除线：~~text~~ -> <del>text</del>
                    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
                    
                    // 7. 【新增】粗斜体：***text*** 或 **_text_** 或 *__text__* -> <b><i>text</i></b>
                    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
                    text = text.replace(/\*\*_(.+?)_\*\*/g, '<b><i>$1</i></b>');
                    text = text.replace(/\*__(.+?)__\*/g, '<i><b>$1</b></i>');
                    text = text.replace(/___(.+?)___/g, '<b><i>$1</i></b>');
                    
                    // 8. 粗体：**text** -> <b>text</b>
                    text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
                    
                    // 9. 斜体：*text* -> <i>text</i>
                    text = text.replace(/\*(.+?)\*/g, '<i>$1</i>');
                    
                    // 10. 下划线：__text__ -> <u>text</u>（遵循本地版约定：双下划线为下划线）
                    text = text.replace(/__(.+?)__/g, '<u>$1</u>');
                    
                    // 11. HTML 标签转义（防止 XSS）- 将剩余的 < > 转为实体
                    text = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    
                    // 12. 恢复允许的 HTML 标签（b, i, u, br, del）- 将授权的实体转回标签
                    text = text.replace(/&lt;(b|i|u|br|del)\s*\/?&gt;/g, '<$1>');
                    text = text.replace(/&lt;\/(b|i|u|del)&gt;/g, '</$1>');
                    
                    // 13. 处理换行符（\n -> <br>）- 兼容本地版 Enter 换行
                    text = text.replace(/\n/g, '<br>');
                    
                    contentHtml += `<p class="text-gray-600 leading-relaxed mb-4 break-all">${text}</p>`;
                }
            });
        } else {
            contentHtml += '<p class="text-gray-400 italic">暂无详细内容</p>';
        }
        contentHtml += '</div>';
        
        // 版本切换
        if (entry.versions.length > 1) {
            contentHtml += `
                <div class="mt-8 pt-6 border-t border-gray-200">
                    <h3 class="text-sm font-bold text-gray-500 uppercase mb-3">版本切换</h3>
                    <div class="flex flex-wrap gap-2">
            `;
            entry.versions.forEach((v, idx) => {
                const isCurrent = v.vid === version.vid;
                const vLevel = v.level || 5;
                contentHtml += `
                    <button onclick="app.switchToVersion('${entry.id}', '${v.vid}')" 
                        class="px-3 py-1.5 rounded-lg text-sm ${isCurrent ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} flex items-center gap-1">
                        版本 ${idx + 1}: ${v.title || '未命名'}
                        <span class="text-[10px] opacity-70 ml-1">Lv.${vLevel}</span>
                    </button>
                `;
            });
            contentHtml += '</div></div>';
        }
        
        contentEl.innerHTML = contentHtml;
        container.appendChild(clone);
    },
    // 【修复】解析角色引用格式 @姓名[编号] → 蓝色标签
    parseCharacterReferences(text) {
        if (!text) return '';
        
        // 【修复】使用正确的正则表达式：/@姓名[C-001]/
        // [^\[\]] 匹配非方括号字符，\[ 匹配字面量左方括号
        return text.replace(/@([^\[]+)\[([^\]]+)\]/g, (match, name, code) => {
            const entry = this.data.entries.find(e => e.code === code);
            const entryId = entry ? entry.id : '';
            return `<span class="synopsis-entry-ref" data-entry-id="${entryId}" data-entry-code="${code}" onclick="app.openEntryByCode('${code}')"><i class="fa-solid fa-user text-xs mr-1"></i>${name}</span>`;
        });
    },

    // 【新增】通过编号打开条目
    openEntryByCode(code) {
        const entry = this.data.entries.find(e => e.code === code);
        if (entry) {
            this.openEntry(entry.id);
        } else {
            this.showToast('未找到该角色', 'warning');
        }
    },

    renderEdit(container) {
        const isNew = !this.data.editingId;
        
        // 初始化临时数据
        if (isNew) {
            const type = this.data.editingType || 'character';
            const code = this.generateCode(type);
            
            this.tempEntry = {
                id: (type === 'character' ? 'char-' : 'non-') + Date.now(),
                type: type,
                code: code,
                versions: [],
                pinned: false,
                pinStartChapter: null,
                pinEndChapter: null,
                pinnedVersions: {},
                missingIntervalVersion: null,
                defaultPinnedVersion: null
            };
            
            this.tempVersion = {
                vid: 'v-' + Date.now(),
                title: '',
                subtitle: '',
                level: 5,
                images: { avatar: null, card: null, cover: null },
                chapterFrom: null,
                chapterTo: null,
                blocks: [],
                relatedCharacters: [],
                relatedVersions: [],
                createdAt: Date.now()
            };
            
            this.tempEntry.versions.push(this.tempVersion);
            this.editingVersionId = this.tempVersion.vid;
            this.editState.hasChanges = true;
        } else {
            const entry = this.data.entries.find(e => e.id === this.data.editingId);
            this.tempEntry = JSON.parse(JSON.stringify(entry));
            this.tempVersion = JSON.parse(JSON.stringify(entry.versions[entry.versions.length - 1]));
            this.editingVersionId = this.tempVersion.vid;
            this.editState.originalEntry = JSON.parse(JSON.stringify(entry));
            this.editState.originalVersion = JSON.parse(JSON.stringify(this.tempVersion));
            this.editState.hasChanges = false;
        }
        
        this.editState.undoStack = [];
        this.editState.redoStack = [];
        
        const tpl = document.getElementById('tpl-detail-edit');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        const titleInput = clone.getElementById('edit-title');
        const codeInput = clone.getElementById('edit-code');
        const subtitleInput = clone.getElementById('edit-subtitle');
        const levelSelect = document.getElementById('edit-level');
        const levelPreview = document.getElementById('level-preview');
        if (levelSelect) {
            // 设置当前值
            levelSelect.value = this.tempVersion.level || 5;
            
            // 更新星级预览函数
            const updatePreview = () => {
                const level = parseInt(levelSelect.value);
                const stars = '★'.repeat(6 - level) + '☆'.repeat(level - 1);
                if (levelPreview) levelPreview.textContent = stars;
            };
            
            // 初始化预览
            updatePreview();
            
            // 监听变化
            levelSelect.onchange = () => {
                this.tempVersion.level = parseInt(levelSelect.value);
                updatePreview();
                this.editState.hasChanges = true;
            };
        }
        
        if (titleInput) titleInput.value = this.tempVersion.title;
        if (codeInput) codeInput.value = this.tempEntry.code;
        if (subtitleInput) subtitleInput.value = this.tempVersion.subtitle || '';
        
        // 绑定键盘快捷键
        this.bindEditKeyboardShortcuts();
        
        container.appendChild(clone);
    },
    insertFormat(tag) {
        const subtitleInput = document.getElementById('edit-subtitle');
        if (!subtitleInput) return;
        
        const start = subtitleInput.selectionStart;
        const end = subtitleInput.selectionEnd;
        const text = subtitleInput.value;
        const before = text.substring(0, start);
        const selected = text.substring(start, end);
        const after = text.substring(end);
        
        let insertText = '';
        if (tag === 'br') {
            insertText = '\n';
            subtitleInput.value = before + insertText + after;
            subtitleInput.selectionStart = subtitleInput.selectionEnd = start + 1;
        } else {
            insertText = `<${tag}>${selected}</${tag}>`;
            subtitleInput.value = before + insertText + after;
            subtitleInput.selectionStart = start;
            subtitleInput.selectionEnd = start + insertText.length;
        }
        
        subtitleInput.focus();
        this.tempVersion.subtitle = subtitleInput.value;
        this.editState.hasChanges = true;
    },
    
    // 添加帮助对话框
    showHelpDialog() {
        this.showAlertDialog({
            title: '格式帮助',
            message: '题记支持以下HTML标签：\n\n<b>粗体</b>\n<i>斜体</i>\n<u>下划线</u>\n<br>换行\n\n示例：<b>强调文字</b>',
            type: 'info'
        });
    },
    renderSettings(container) {
        const tpl = document.getElementById('tpl-settings');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        // 显示/隐藏编辑相关设置
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        // 更新GitHub仓库显示
        if (this.runMode === 'backend' && this.githubStorage.isConfigured()) {
            const repoDisplay = clone.getElementById('github-repo-display');
            if (repoDisplay) {
                repoDisplay.textContent = `${this.githubStorage.config.owner}/${this.githubStorage.config.repo}`;
            }
            
            // 加载分享码列表
            this.loadShareCodeList(clone.getElementById('share-code-list'));
        }
        
        // 【关键修复】在模板内容中直接插入图片修复按钮（而不是插入到container后再查找）
        // 查找设置页面的主要内容区域（通常是最后一个section或特定容器）
        const settingsForm = clone.querySelector('form') || clone.querySelector('.space-y-6') || clone.querySelector('div[class*="max-w"]');
        
        if (settingsForm) {
            const repairSection = document.createElement('div');
            repairSection.id = 'repair-images-section';
            repairSection.className = 'mt-8 p-6 bg-amber-50 border-2 border-amber-200 rounded-xl';
            repairSection.innerHTML = `
                <h3 class="font-bold text-lg text-amber-800 mb-2 flex items-center gap-2">
                    <i class="fa-solid fa-images"></i> 图片引用修复
                </h3>
                <p class="text-sm text-amber-700 mb-4">
                    如果导入后图片不显示，或图片显示为破损图标，可点击以下按钮自动重建图片引用。
                    此操作会扫描远程仓库中的所有图片，并与本地词条进行匹配。
                </p>
                <div class="flex gap-3">
                    <button type="button" id="btn-repair-images" class="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition flex items-center justify-center gap-2">
                        <i class="fa-solid fa-wrench"></i> 立即修复引用
                    </button>
                    <button type="button" id="btn-save-after-repair" class="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition flex items-center justify-center gap-2 hidden">
                        <i class="fa-solid fa-save"></i> 保存修复结果
                    </button>
                </div>
                <div id="repair-result-text" class="mt-3 text-sm text-gray-600 hidden"></div>
            `;
            
            // 插入到表单末尾
            settingsForm.appendChild(repairSection);
            
            // 【关键】立即绑定事件（在添加到DOM之前就可以绑定，但保险起见用事件委托或确保元素已存在）
            // 使用延迟确保元素已在DOM中
            setTimeout(() => {
                const btnRepair = document.getElementById('btn-repair-images');
                const btnSave = document.getElementById('btn-save-after-repair');
                const resultText = document.getElementById('repair-result-text');
                
                if (btnRepair) {
                    btnRepair.onclick = async () => {
                        btnRepair.disabled = true;
                        btnRepair.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在修复...';
                        resultText.classList.remove('hidden');
                        resultText.textContent = '正在获取远程图片列表...';
                        
                        try {
                            const fixed = await this.autoFixImageReferences();
                            
                            if (fixed > 0) {
                                resultText.innerHTML = `<span class="text-green-600 font-medium">✅ 成功建立 ${fixed} 个图片引用</span>`;
                                btnRepair.innerHTML = '<i class="fa-solid fa-check"></i> 修复完成';
                                
                                if (this.runMode === 'backend' && btnSave) {
                                    btnSave.classList.remove('hidden');
                                }
                            } else {
                                resultText.innerHTML = `<span class="text-amber-600">⚠️ 未找到需要修复的图片引用</span><br><span class="text-xs text-gray-500">可能原因：1. 图片未上传到仓库 2. 文件名不匹配</span>`;
                                btnRepair.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 未匹配';
                            }
                        } catch (e) {
                            resultText.innerHTML = `<span class="text-red-600">❌ 修复失败: ${e.message}</span>`;
                            btnRepair.innerHTML = '<i class="fa-solid fa-times"></i> 重试';
                            btnRepair.disabled = false;
                        }
                    };
                }
                
                if (btnSave) {
                    btnSave.onclick = async () => {
                        if (confirm('确定将修复后的图片引用保存到 GitHub？')) {
                            btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中...';
                            try {
                                await this.saveDataAtomic();
                                alert('✅ 已保存！图片引用已永久写入 GitHub。');
                                btnSave.classList.add('hidden');
                            } catch (e) {
                                alert('❌ 保存失败: ' + e.message);
                                btnSave.innerHTML = '<i class="fa-solid fa-save"></i> 重试保存';
                            }
                        }
                    };
                }
            }, 50); // 短延迟确保DOM已渲染
        }
        
        container.appendChild(clone);
    },

    // ========== 剧情梗概 ==========
    renderSynopsis: function(container) {
        var self = this;
        var tpl = document.getElementById('tpl-synopsis-view');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">剧情梗概模板未找到</div>';
            return;
        }
        
        var clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        var list = document.getElementById('synopsis-view-list');
        if (list) {
            this.data.synopsis.forEach(function(chapter) {
                var item = document.createElement('div');
                item.className = 'synopsis-chapter-item p-6 border-b border-gray-200';
                
                var imageHtml = '';
                if (chapter.image && chapter.image.startsWith('http')) {
                    imageHtml = '<div class="mb-4 rounded-xl overflow-hidden shadow-md">' +
                        '<img src="' + chapter.image + '" class="w-full max-h-64 object-cover" alt="' + (chapter.title || '') + '" onerror="this.style.display=\'none\'">' +
                    '</div>';
                }
                
                var content = chapter.content || '';
                
                // 处理 @姓名[编号] - 纯字符串处理，零正则
                var result = '';
                var pos = 0;
                while (pos < content.length) {
                    var atPos = content.indexOf('@', pos);
                    if (atPos === -1) {
                        result += content.substring(pos);
                        break;
                    }
                    
                    result += content.substring(pos, atPos);
                    
                    var openBracket = content.indexOf('[', atPos);
                    var closeBracket = content.indexOf(']', atPos);
                    
                    if (openBracket > atPos && closeBracket > openBracket) {
                        var name = content.substring(atPos + 1, openBracket);
                        var code = content.substring(openBracket + 1, closeBracket);
                        
                        // 简单验证：C-001, N-002 格式
                        var isValid = code.length === 5 && 
                                    code.charAt(1) === '-' && 
                                    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(code.charAt(0)) !== -1 &&
                                    '0123456789'.indexOf(code.charAt(2)) !== -1 &&
                                    '0123456789'.indexOf(code.charAt(3)) !== -1 &&
                                    '0123456789'.indexOf(code.charAt(4)) !== -1;
                        
                        if (isValid) {
                            var entry = self.data.entries.find(function(e) { return e.code === code; });
                            if (entry) {
                                result += `<span class="synopsis-entry-ref" data-entry-id="${entry.id}" data-entry-code="${code}" onclick="app.openEntryByCode('${code}')"><i class="fa-solid fa-user text-xs mr-1"></i>${name}<span class="text-xs opacity-70 ml-1 font-mono">${code}</span></span>`;
                                pos = closeBracket + 1;
                                continue;
                            }
                        }
                    }
                    
                    result += '@';
                    pos = atPos + 1;
                }
                content = result;
                
                // 换行处理（不使用正则）
                content = content.split('\n').join('<br>');
                
                item.innerHTML = 
                    '<h3 class="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">' +
                        '<span class="bg-indigo-600 text-white text-sm px-2 py-1 rounded-md font-mono">' + self.formatChapterNum(chapter.num) + '</span>' +
                        '<span>' + (chapter.title || '第' + chapter.num + '章') + '</span>' +
                    '</h3>' +
                    imageHtml +
                    '<div class="prose prose-sm max-w-none text-gray-600 leading-relaxed">' +
                        (content || '<p class="text-gray-400 italic">暂无内容</p>') +
                    '</div>';
                list.appendChild(item);
            });
        }
    },

    renderSynopsisEdit(container) {
        const tpl = document.getElementById('tpl-synopsis-edit');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">剧情梗概编辑模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        const list = document.getElementById('synopsis-chapters-list');
        if (list) {
            this.data.synopsis.forEach(chapter => {
                const item = document.createElement('div');
                item.className = 'bg-white rounded-lg border border-gray-200 mb-4 overflow-hidden';
                
                // 【新增】图片显示区域
                let imageSection = '';
                if (chapter.image) {
                    imageSection = `
                        <div class="relative mb-3 rounded-lg overflow-hidden bg-gray-100 h-32">
                            <img src="${chapter.image}" class="w-full h-full object-cover" onerror="this.src=''">
                            <button onclick="app.removeSynopsisImage('${chapter.id}')" class="absolute top-2 right-2 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-600">
                                <i class="fa-solid fa-times text-xs"></i>
                            </button>
                        </div>
                    `;
                }
                
                item.innerHTML = `
                    <div class="flex items-center gap-3 p-3 bg-gray-50 border-b border-gray-200">
                        <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold">${this.formatChapterNum(chapter.num)}</span>
                        <input type="text" class="flex-1 bg-transparent border-none outline-none text-sm font-medium" 
                            value="${chapter.title || ''}" onchange="app.updateSynopsisTitle('${chapter.id}', this.value)">
                        <button onclick="app.removeSynopsisChapter('${chapter.id}')" class="text-red-500 hover:text-red-700 p-1.5">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                    <div class="p-3">
                        ${imageSection}
                        <div class="flex gap-2 mb-3">
                            <label class="flex-1 cursor-pointer bg-gray-100 hover:bg-gray-200 rounded-lg p-2 text-center text-xs text-gray-600 transition">
                                <i class="fa-solid fa-image mr-1"></i>选择图片
                                <input type="file" class="hidden" accept="image/*" onchange="app.uploadSynopsisImage('${chapter.id}', this)">
                            </label>
                        </div>
                        <textarea class="w-full p-2 border border-gray-200 rounded-lg text-sm resize-none" rows="4"
                            onchange="app.updateSynopsisContent('${chapter.id}', this.value)">${chapter.content || ''}</textarea>
                    </div>
                `;
                list.appendChild(item);
            });
        }
    },
    // 【新增】上传剧情梗概图片
    async uploadSynopsisImage(chapterId, input) {
        const file = input.files[0];
        if (!file) return;
        
        try {
            // 转换为 base64
            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(file);
            });
            
            // 压缩
            const compressed = await this.compressImageIfNeeded(dataUrl, 1920, 1080, 0.85, 2);
            
            // 生成文件名
            const filename = `synopsis-${chapterId}-${Date.now()}.jpg`;
            
            // 上传
            await this.githubStorage.saveImage(filename, compressed);
            
            // 更新数据
            const chapter = this.data.synopsis.find(s => s.id === chapterId);
            if (chapter) {
                chapter.image = `{{IMG:${filename}}}`;
                // 立即解析为URL以便显示
                const { owner, repo, branch, dataPath } = this.githubStorage.config;
                chapter.image = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dataPath}/images/${filename}`;
            }
            
            // 保存并刷新
            await this.saveData();
            this.renderSynopsisEdit(document.getElementById('main-container'));
            this.showToast('图片上传成功', 'success');
            
        } catch (e) {
            this.showToast('图片上传失败: ' + e.message, 'error');
        }
        
        input.value = '';
    },

    // 【新增】删除剧情梗概图片
    async removeSynopsisImage(chapterId) {
        const confirmed = await this.showConfirmDialog({
            title: '删除确认',
            message: '确定删除此章节的图片？',
            confirmText: '删除',
            cancelText: '取消',
            type: 'warning'
        });
        
        if (confirmed) {
            const chapter = this.data.synopsis.find(s => s.id === chapterId);
            if (chapter) {
                chapter.image = null;
                await this.saveData();
                this.renderSynopsisEdit(document.getElementById('main-container'));
            }
        }
    },

    syncSynopsisWithChapters() {
        // 如果 synopsis 为空，初始化
        if (!this.data.synopsis) {
            this.data.synopsis = [];
        }
        
        // 构建现有剧情梗概映射（用于快速查找）
        const existingSynopsis = {};
        this.data.synopsis.forEach(s => { 
            if (s.chapterId) existingSynopsis[s.chapterId] = s; 
        });
        
        const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
        const newSynopsis = [];
        
        sortedChapters.forEach(ch => {
            if (existingSynopsis[ch.id]) {
                // 【关键】保留现有剧情梗概（包括导入的内容和图片）
                const existing = existingSynopsis[ch.id];
                // 更新章节基本信息（编号、标题可能变化）
                existing.num = ch.num;
                existing.title = existing.title || ch.title || `第${ch.num}章`;
                newSynopsis.push(existing);
            } else {
                // 新建空的剧情梗概
                newSynopsis.push({
                    id: 'syn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                    chapterId: ch.id,
                    num: ch.num,
                    title: ch.title || `第${ch.num}章`,
                    content: '',
                    image: null
                });
            }
        });
        
        this.data.synopsis = newSynopsis;
    },

    updateSynopsisTitle(chapterId, title) {
        const chapter = this.data.synopsis.find(s => s.id === chapterId);
        if (chapter) chapter.title = title;
    },

    updateSynopsisContent(chapterId, content) {
        const chapter = this.data.synopsis.find(s => s.id === chapterId);
        if (chapter) chapter.content = content;
    },

    removeSynopsisChapter(chapterId) {
        this.showConfirmDialog({
            title: '删除确认',
            message: '确定删除此章节的剧情梗概？',
            confirmText: '删除',
            cancelText: '取消',
            type: 'warning'
        }).then(confirmed => {
            if (confirmed) {
                this.data.synopsis = this.data.synopsis.filter(s => s.id !== chapterId);
                this.renderSynopsisEdit(document.getElementById('main-container'));
            }
        });
    },

    addSynopsisChapter() {
        const num = this.data.chapters.length + 1;
        const chapterId = 'ch-' + Date.now();
        
        // 添加章节
        this.data.chapters.push({
            id: chapterId,
            num: num,
            title: `第${num}章`,
            order: num
        });
        
        // 同步添加剧情梗概
        this.data.synopsis.push({
            id: 'syn-' + Date.now(),
            chapterId: chapterId,
            num: num,
            title: `第${num}章`,
            content: '',
            image: null
        });
        
        this.renderSynopsisEdit(document.getElementById('main-container'));
    },

    saveSynopsis() {
        this.saveData();
        this.showToast('剧情梗概已保存', 'success');
    },

    // ========== 时间轴/章节管理 ==========
    renderTimelineSettings(container) {
        const tpl = document.getElementById('tpl-timeline-settings');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">章节管理模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        const list = document.getElementById('timeline-chapters-list');
        if (list) {
            const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
            sortedChapters.forEach((ch, idx) => {
                const item = document.createElement('div');
                item.className = 'flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200';
                item.innerHTML = `
                    <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold font-mono w-16 text-center">${this.formatChapterNum(ch.num)}</span>
                    <input type="text" class="flex-1 bg-transparent border border-gray-200 rounded px-2 py-1 text-sm" 
                        value="${ch.title}" onchange="app.updateChapterTitle('${ch.id}', this.value)">
                    <button onclick="app.moveChapter('${ch.id}', -1)" class="text-gray-400 hover:text-gray-600 p-1" ${idx === 0 ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-up"></i>
                    </button>
                    <button onclick="app.moveChapter('${ch.id}', 1)" class="text-gray-400 hover:text-gray-600 p-1" ${idx === sortedChapters.length - 1 ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-down"></i>
                    </button>
                    <button onclick="app.deleteChapter('${ch.id}')" class="text-red-400 hover:text-red-600 p-1">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                `;
                list.appendChild(item);
            });
        }
    },

    updateChapterTitle(chapterId, title) {
        const chapter = this.data.chapters.find(c => c.id === chapterId);
        if (chapter) {
            chapter.title = title;
            // 同步更新剧情梗概标题
            const synopsis = this.data.synopsis.find(s => s.chapterId === chapterId);
            if (synopsis) synopsis.title = title;
        }
    },

    moveChapter(chapterId, direction) {
        const idx = this.data.chapters.findIndex(c => c.id === chapterId);
        if (idx === -1) return;
        
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= this.data.chapters.length) return;
        
        // 交换位置
        const temp = this.data.chapters[idx];
        this.data.chapters[idx] = this.data.chapters[newIdx];
        this.data.chapters[newIdx] = temp;
        
        // 更新order
        this.data.chapters.forEach((c, i) => c.order = i + 1);
        
        this.renderTimelineSettings(document.getElementById('main-container'));
    },

    deleteChapter(chapterId) {
        this.showConfirmDialog({
            title: '删除确认',
            message: '确定删除此章节？相关的剧情梗概也会被删除。',
            confirmText: '删除',
            cancelText: '取消',
            type: 'danger'
        }).then(confirmed => {
            if (confirmed) {
                this.data.chapters = this.data.chapters.filter(c => c.id !== chapterId);
                this.data.synopsis = this.data.synopsis.filter(s => s.chapterId !== chapterId);
                this.renderTimelineSettings(document.getElementById('main-container'));
            }
        });
    },

    addChapter() {
        const num = this.data.chapters.length + 1;
        const chapterId = 'ch-' + Date.now();
        
        this.data.chapters.push({
            id: chapterId,
            num: num,
            title: `第${num}章`,
            order: num
        });
        
        // 同步添加剧情梗概
        this.data.synopsis.push({
            id: 'syn-' + Date.now(),
            chapterId: chapterId,
            num: num,
            title: `第${num}章`,
            content: '',
            image: null
        });
        
        this.renderTimelineSettings(document.getElementById('main-container'));
    },

    saveTimelineSettings() {
        this.saveData();
        this.showToast('章节设置已保存', 'success');
    },

    // ========== 关系图 ==========
    renderGraph(container) {
        const tpl = document.getElementById('tpl-graph');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">关系图模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        // 简单的关系图渲染
        const graphContainer = document.getElementById('graph-container');
        if (graphContainer) {
            // 获取所有角色词条
            const characters = this.data.entries.filter(e => e.type === 'character');
            
            if (characters.length === 0) {
                graphContainer.innerHTML = '<div class="text-center text-gray-400 py-10">暂无角色数据</div>';
                return;
            }
            
            // 渲染角色节点
            characters.forEach(entry => {
                const version = this.getVisibleVersion(entry);
                if (!version) return;
                
                const node = document.createElement('div');
                node.className = 'absolute bg-white rounded-lg shadow-md border border-gray-200 p-3 cursor-pointer hover:shadow-lg transition';
                node.style.left = `${Math.random() * 60 + 10}%`;
                node.style.top = `${Math.random() * 60 + 10}%`;
                node.innerHTML = `
                    <div class="text-sm font-medium text-gray-800">${version.title}</div>
                    <div class="text-xs text-gray-500">${entry.code}</div>
                `;
                node.onclick = () => this.openEntry(entry.id);
                graphContainer.appendChild(node);
            });
        }
    },

    // ========== 公告编辑 ==========
    renderAnnouncementEdit(container) {
        const tpl = document.getElementById('tpl-announcement-edit');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">公告编辑模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
    },
    // 【完整替换】saveAnnouncement 函数 - 使用原子保存确保数据完整性
    async saveAnnouncement() {
        const titleInput = document.getElementById('announcement-edit-title');
        const authorInput = document.getElementById('announcement-edit-author');
        const contentInput = document.getElementById('announcement-edit-content');
        
        const title = titleInput?.value?.trim();
        const author = authorInput?.value?.trim();
        const content = contentInput?.value?.trim();

        if (!title) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请输入公告标题',
                type: 'warning'
            });
            return;
        }

        // 确保 announcements 数组存在
        if (!this.data.announcements || !Array.isArray(this.data.announcements)) {
            this.data.announcements = [];
        }

        const newAnn = {
            id: 'ann-' + Date.now(),
            title,
            author: author || '匿名',
            content: content || '',
            createdAt: Date.now(),
            date: new Date().toLocaleDateString('zh-CN'),
            isActive: true
        };
        
        // 将其他公告设为非活跃
        this.data.announcements.forEach(a => a.isActive = false);
        this.data.announcements.unshift(newAnn);

        try {
            console.log('[Announcement] 正在保存公告...', newAnn);
            
            // 【关键】使用原子保存模式，避免分片导致数据丢失
            await this.saveDataAtomic();
            
            this.showToast('公告已发布', 'success');
            
            // 保存成功后返回首页
            this.router('home');
            
        } catch (error) {
            console.error('[Announcement] 保存失败:', error);
            this.showAlertDialog({
                title: '保存失败',
                message: '公告保存失败: ' + error.message + '\n\n建议：\n1. 检查GitHub Token是否有效\n2. 尝试重新导入数据\n3. 刷新页面后重试',
                type: 'error'
            });
        }
    },

    // 【新增】原子保存方法（非分片，确保数据完整性）
    async saveDataAtomic() {
        console.log('[Wiki] 执行原子保存...');
        
        // 【长期防护】保存前强制校验并修复数据
        const validation = this.validateAndFixData();
        if (validation.fixed > 0) {
            console.warn(`[Save] 已自动修复 ${validation.fixed} 处数据异常`);
        }
        
        // 深拷贝数据
        const dataToSave = JSON.parse(JSON.stringify(this.data));
        
        // 清理内嵌base64图片（避免体积过大）
        if (dataToSave.entries) {
            dataToSave.entries.forEach(entry => {
                if (entry.versions) {
                    entry.versions.forEach(v => {
                        if (v.image && v.image.startsWith('data:')) v.image = null;
                        if (v.images) {
                            Object.keys(v.images).forEach(k => {
                                if (v.images[k] && v.images[k].startsWith('data:')) v.images[k] = null;
                            });
                        }
                    });
                }
            });
        }
        
        // 添加版本标记
        dataToSave.version = '2.7.0-atomic';
        dataToSave.lastUpdate = Date.now();
        
        const content = JSON.stringify(dataToSave, null, 2);
        
        try {
            // 直接保存到 data.json，不使用分片
            await this.githubStorage.putFile('data.json', content, 'Update Wiki data (atomic save)', false, 5);
            
            console.log('[Wiki] 原子保存成功');
            return true;
        } catch (error) {
            console.error('[Wiki] 原子保存失败:', error);
            throw error;
        }
    },

    // 【完整替换】renderAnnouncementBanner 函数 - 确保两种模式都显示
    renderAnnouncementBanner() {
        // 【关键】查找活跃公告（不区分模式，数据应该一致）
        const activeAnn = this.data.announcements?.find(a => a.isActive);
        const annSection = document.getElementById('announcement-section');
        
        if (!annSection) {
            console.warn('[Announcement] 找不到公告区域');
            return;
        }
        
        console.log('[Announcement] 渲染公告:', activeAnn?.title || '无', '模式:', this.runMode);
        
        if (activeAnn) {
            annSection.classList.remove('hidden');
            
            const annTitle = document.getElementById('announcement-title');
            const annPreview = document.getElementById('announcement-preview');
            const annMeta = document.getElementById('announcement-meta');
            
            if (annTitle) annTitle.textContent = activeAnn.title || '最新公告';
            
            if (annPreview) {
                // 去除HTML标签获取纯文本预览
                const temp = document.createElement('div');
                temp.innerHTML = activeAnn.content || '';
                const text = temp.textContent || '';
                annPreview.textContent = text.substring(0, 100) + (text.length > 100 ? '...' : '');
            }
            
            if (annMeta) {
                annMeta.innerHTML = `
                    <i class="fa-solid fa-user-pen mr-1"></i>${activeAnn.author || '匿名'} 
                    <span class="mx-2">•</span> 
                    <i class="fa-regular fa-calendar mr-1"></i>${activeAnn.date || new Date(activeAnn.createdAt).toLocaleDateString('zh-CN')}
                `;
            }
            
            // 绑定点击事件查看详情
            const banner = annSection.querySelector('.announcement-banner');
            if (banner) {
                banner.onclick = () => this.viewAnnouncement();
            }
        } else {
            annSection.classList.add('hidden');
        }
    },

    createAnnouncement() {
        this.data.currentAnnouncement = null;
        this.router('announcement-edit');
    },

    viewAnnouncement() {
        const ann = this.data.announcements?.find(a => a.isActive);
        if (!ann) {
            this.showToast('当前没有生效的公告', 'info');
            return;
        }
        
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
                <div class="p-4 border-b bg-gradient-to-r from-orange-50 to-amber-50 flex justify-between items-center">
                    <div>
                        <h3 class="font-bold text-lg text-gray-800">${ann.title || '公告'}</h3>
                        <p class="text-xs text-gray-500">${ann.author || '匿名'} · ${ann.date}</p>
                    </div>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="p-6 overflow-y-auto prose prose-sm max-w-none">
                    ${ann.content || ''}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    viewAnnouncementHistory() {
        if (!this.data.announcements || this.data.announcements.length === 0) {
            this.showToast('暂无历史公告', 'info');
            return;
        }
        
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
                <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold text-lg text-gray-800">历史公告</h3>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="p-4 overflow-y-auto space-y-3">
                    ${this.data.announcements.map(ann => `
                        <div class="p-3 bg-gray-50 rounded-lg border ${ann.isActive ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}">
                            <div class="flex justify-between items-start">
                                <h4 class="font-medium text-gray-800">${ann.title || '无标题'}</h4>
                                ${ann.isActive ? '<span class="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">生效中</span>' : ''}
                            </div>
                            <p class="text-xs text-gray-500 mt-1">${ann.author || '匿名'} · ${ann.date}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    // ========== 词条操作 ==========
    // 【替换 createEntryCard 函数】增强版，支持实时解析和错误处理
    createEntryCard(entry, version, isPinned = false) {
        const div = document.createElement('div');
        div.className = 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-300 active:scale-95 flex flex-col w-3/4 mx-auto';
        div.onclick = () => this.openEntry(entry.id);
        
        // 计算重要程度星级
        const level = version.level || 5;
        const starCount = 6 - level;
        const levelStars = '★'.repeat(starCount) + '☆'.repeat(5 - starCount);
        const levelColor = level <= 2 ? 'text-amber-500' : (level === 3 ? 'text-blue-500' : 'text-gray-400');
        
        // 实时获取并解析图片 URL
        let imgUrl = version.images?.card || version.images?.avatar || version.image || '';
        
        if (typeof imgUrl === 'string' && imgUrl.includes('{{IMG:')) {
            const match = imgUrl.match(/\{\{IMG:\s*([^}]+)\s*\}\}/);
            if (match && this.githubStorage?.config?.owner) {
                const { owner, repo, branch, dataPath } = this.githubStorage.config;
                imgUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dataPath || 'wiki-data'}/images/${encodeURIComponent(match[1])}`;
            }
        }
        
        const hasImage = typeof imgUrl === 'string' && imgUrl.startsWith('http');
        
        // 【关键】确保 isPinned 是布尔值，避免 undefined
        const showPin = !!isPinned;
        const pinnedBadge = showPin ? 
            `<div class="absolute top-2 left-2 z-20 bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded font-bold shadow-sm">
                <i class="fa-solid fa-thumbtack mr-1"></i>推荐
            </div>` : '';
        
        div.innerHTML = `
            <div class="relative aspect-[3/4] overflow-hidden bg-gray-100 shrink-0">
                ${pinnedBadge}
                <div class="absolute top-2 right-2 z-20 ${levelColor} text-xs font-bold bg-white/90 backdrop-blur px-1.5 py-0.5 rounded shadow-sm border border-gray-100" title="重要程度：Lv.${level}">
                    ${levelStars}
                </div>
                
                ${hasImage ? 
                    `<img src="${imgUrl}" 
                        class="w-full h-full object-cover transition-transform duration-500 hover:scale-110" 
                        alt="${version.title || entry.code}"
                        onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\'w-full h-full flex items-center justify-center text-gray-300\'><i class=\'fa-solid fa-image text-4xl\'></i></div>'">` :
                    `<div class="w-full h-full flex items-center justify-center text-gray-300"><i class="fa-solid fa-user text-4xl"></i></div>`
                }
                <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
                    <div class="text-white font-bold text-sm truncate">${version.title || '未命名'}</div>
                    <div class="text-white/80 text-xs font-mono truncate flex justify-between items-center">
                        <span>${entry.code}</span>
                        <span class="text-[10px] opacity-90 bg-black/30 px-1.5 rounded">Lv.${level}</span>
                    </div>
                </div>
            </div>
            <div class="p-3 flex-1 flex flex-col justify-between min-h-[60px]">
                <p class="text-xs text-gray-500 line-clamp-2">${version.subtitle || ''}</p>
            </div>
        `;
        
        return div;
    },


    openEntry(id) {
        this.data.editingId = id;
        this.router('detail');
    },

    createEntry(type) {
        this.data.editingType = type;
        this.data.editingId = null;
        this.router('edit');
    },

    createEntryFromList() {
        const type = this.data.currentTarget === 'characters' ? 'character' : 'non-character';
        this.createEntry(type);
    },

    editCurrentEntry() {
        this.router('edit');
    },

    switchToVersion(entryId, versionId) {
        try {
            this.data.editingId = entryId;
            this.data.viewingVersionId = versionId;
            // 使用 setTimeout 避免阻塞主线程，解决 Promise 回调问题
            setTimeout(() => {
                this.router('detail', false);
            }, 0);
        } catch (e) {
            console.error('[switchToVersion] 错误:', e);
        }
    },

    // ========== 保存词条 ==========
    async saveEntry() {
        if (!this.tempEntry || !this.tempVersion) return;
        
        this.tempVersion.title = document.getElementById('edit-title')?.value?.trim() || '';
        this.tempVersion.subtitle = document.getElementById('edit-subtitle')?.value?.trim() || '';
        this.tempVersion.level = parseInt(document.getElementById('edit-level')?.value || 5);
        
        if (!this.tempVersion.title) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请输入版本名称',
                type: 'warning'
            });
            return;
        }
        
        const existingIndex = this.data.entries.findIndex(e => e.id === this.tempEntry.id);
        if (existingIndex >= 0) {
            this.data.entries[existingIndex] = this.tempEntry;
        } else {
            this.data.entries.push(this.tempEntry);
        }
        
        try {
            await this.githubStorage.saveWikiData(this.data);
            this.showToast('保存成功', 'success');
            this.editState.hasChanges = false;
            this.unbindEditKeyboardShortcuts();
            this.tempEntry = null;
            this.tempVersion = null;
            this.router('home');
        } catch (error) {
            console.error('保存失败:', error);
            this.showAlertDialog({
                title: '保存失败',
                message: '无法保存到GitHub: ' + error.message,
                type: 'error'
            });
        }
    },

    async cancelEdit() {
        if (!this.editState.hasChanges && this.editState.undoStack.length === 0) {
            this.unbindEditKeyboardShortcuts();
            this.tempEntry = null;
            this.tempVersion = null;
            this.data.editingType = null;
            this.router('home');
            return;
        }
        
        const confirmed = await this.showConfirmDialog({
            title: '放弃编辑',
            message: '确定放弃当前编辑？\n未保存的修改将丢失。',
            confirmText: '放弃',
            cancelText: '继续编辑',
            type: 'warning'
        });
        
        if (confirmed) {
            this.unbindEditKeyboardShortcuts();
            this.tempEntry = null;
            this.tempVersion = null;
            this.data.editingType = null;
            this.editState.hasChanges = false;
            this.editState.undoStack = [];
            this.editState.redoStack = [];
            this.router('home');
        }
    },

    // ========== 删除词条 ==========
    async deleteEntry(id) {
        const index = this.data.entries.findIndex(e => e.id === id);
        if (index >= 0) {
            this.data.entries.splice(index, 1);
            
            try {
                await this.githubStorage.saveWikiData(this.data);
                this.showToast('删除成功', 'success');
                this.router('home');
            } catch (error) {
                console.error('删除失败:', error);
                this.showAlertDialog({
                    title: '删除失败',
                    message: '无法保存更改',
                    type: 'error'
                });
            }
        }
    },

    // ========== 数据导入 ==========
        async handleImportFolder(input) {
        const files = input.files;
        if (!files || files.length === 0) {
            this.showImportStatus('请选择文件夹', 'error');
            return;
        }

        this.showImportStatus('正在读取文件...', 'info');

        // 使用对象存储候选文件，避免重复声明
        const candidates = {
            dataJson: null,
            manifest: null
        };
        const imageFiles = [];

        for (const file of files) {
            const path = file.webkitRelativePath || file.name;
            
            if (path.endsWith('data.json') && !path.includes('/wiki-images/')) {
                candidates.dataJson = file;
            } else if (path.endsWith('wiki-manifest.json') && !path.includes('/wiki-images/')) {
                candidates.manifest = file;
            }
            
            if (path.includes('/wiki-images/') && file.type.startsWith('image/')) {
                imageFiles.push(file);
            }
        }

        // 确定使用哪个数据文件（data.json 优先）
        const dataFile = candidates.dataJson || candidates.manifest;

        if (!dataFile) {
            this.showImportStatus('未找到数据文件（data.json），请确保选择了正确的文件夹', 'error');
            return;
        }

        try {
            const dataText = await dataFile.text();
            const importedData = JSON.parse(dataText);

            if (importedData.mappings && !importedData.entries && !importedData.data) {
                this.showImportStatus('错误：选中了 wiki-manifest.json（资源映射文件），请选择包含 data.json 的文件夹', 'error');
                return;
            }

            if (!importedData.entries && !importedData.data?.entries) {
                this.showImportStatus('数据格式不正确：缺少 entries 数组', 'error');
                return;
            }

            this.showImportStatus(`找到 ${importedData.entries?.length || importedData.data?.entries?.length || 0} 个词条，${imageFiles.length} 张图片，正在导入...`, 'info');

            // 数据合并逻辑（与 ZIP 导入保持一致）
            const entries = importedData.entries || importedData.data?.entries || [];
            const existingIds = new Set(this.data.entries.map(e => e.id));
            let addedCount = 0;
            let skippedCount = 0;

            for (const entry of entries) {
                if (!existingIds.has(entry.id)) {
                    this.data.entries.push(entry);
                    addedCount++;
                } else {
                    skippedCount++;
                }
            }

            const mergeArray = (target, source, key = 'id') => {
                if (!source) return;
                const existing = new Set(target.map(i => i[key]));
                source.forEach(item => {
                    if (!existing.has(item[key])) target.push(item);
                });
            };

            mergeArray(this.data.chapters, importedData.chapters || importedData.data?.chapters);
            mergeArray(this.data.synopsis, importedData.synopsis || importedData.data?.synopsis);
            mergeArray(this.data.announcements, importedData.announcements || importedData.data?.announcements);

            (importedData.camps || importedData.data?.camps || []).forEach(camp => {
                if (!this.data.camps.includes(camp)) this.data.camps.push(camp);
            });

            if (importedData.settings) {
                this.data.settings = { ...this.data.settings, ...importedData.settings };
            }
            if (importedData.wikiTitle) this.data.wikiTitle = importedData.wikiTitle;
            if (importedData.wikiSubtitle) this.data.wikiSubtitle = importedData.wikiSubtitle;

            let uploadedImages = 0;
            if (imageFiles.length > 0 && this.githubStorage) {
                for (const imgFile of imageFiles) {
                    try {
                        const reader = new FileReader();
                        const dataUrl = await new Promise((resolve, reject) => {
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(imgFile);
                        });
                        await this.githubStorage.saveImage(imgFile.name, dataUrl);
                        uploadedImages++;
                    } catch (e) {
                        console.warn('图片上传失败:', imgFile.name, e);
                    }
                }
            }

            await this.githubStorage.saveWikiData(this.data);

            this.showImportStatus(
                `导入成功！新增 ${addedCount} 个词条${skippedCount > 0 ? `（跳过 ${skippedCount} 个重复）` : ''}，上传 ${uploadedImages}/${imageFiles.length} 张图片`,
                'success'
            );

            this.updateUIForMode();
            this.showToast('数据导入成功', 'success');

        } catch (error) {
            console.error('导入失败:', error);
            this.showImportStatus('导入失败: ' + error.message, 'error');
        }

        input.value = '';
    },
        // 处理ZIP文件选择
    handleZipFileSelect(input) {
        const file = input.files[0];
        if (!file) return;
        
        if (!file.name.endsWith('.zip')) {
            this.showAlertDialog({
                title: '格式错误',
                message: '请选择 .zip 格式的文件',
                type: 'warning'
            });
            return;
        }
        // 修改为调用新的带模式选择的导入
        this.importZipFile(file, 'ask'); // 'ask' 会弹出模式选择框
        input.value = '';
    },
    
    // ZIP文件导入（完整版）
    async importZipFile(zipFile) {
        if (!window.JSZip) {
            this.showAlertDialog({
                title: '缺少依赖',
                message: 'JSZip 库未加载，无法解析ZIP文件',
                type: 'error'
            });
            return;
        }

        try {
            this.showToast('正在解析ZIP文件...', 'info');
            const zip = await window.JSZip.loadAsync(zipFile);
            
            // 1. 读取 data.json（必需）
            const dataFile = zip.file('data.json');
            if (!dataFile) {
                throw new Error('ZIP中缺少 data.json 文件');
            }
            
            const dataText = await dataFile.async('string');
            const importedData = JSON.parse(dataText);
            
            // 验证数据结构
            if (!importedData.entries && !importedData.data?.entries) {
                throw new Error('数据格式不正确：缺少 entries 数组');
            }
            
            // 2. 处理图片
            const imageFiles = Object.keys(zip.files).filter(name => 
                name.startsWith('images/') && 
                !zip.files[name].dir &&
                (name.endsWith('.jpg') || name.endsWith('.png') || name.endsWith('.jpeg'))
            );
            
            console.log(`[Import] ZIP中包含 ${imageFiles.length} 张图片`);
            
            let uploadedImages = 0;
            const failedImages = [];
            
            for (const imgPath of imageFiles) {
                const filename = imgPath.replace('images/', '');
                try {
                    const arrayBuffer = await zip.file(imgPath).async('arraybuffer');
                    const blob = new Blob([arrayBuffer]);
                    
                    const dataUrl = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.readAsDataURL(blob);
                    });
                    
                    await this.githubStorage.saveImage(filename, dataUrl);
                    uploadedImages++;
                } catch (e) {
                    console.error(`[Import] 处理图片失败 ${filename}:`, e);
                    failedImages.push(filename);
                }
            }
            
            // 3. 合并数据
            const entries = importedData.entries || importedData.data?.entries || [];
            const existingIds = new Set(this.data.entries.map(e => e.id));
            let addedCount = 0;
            let skipCount = 0;
            
            for (const entry of entries) {
                if (!existingIds.has(entry.id)) {
                    this.data.entries.push(entry);
                    addedCount++;
                } else {
                    skipCount++;
                }
            }
            
            // 合并其他数据（chapters, camps, synopsis, announcements）
            const mergeArray = (target, source, key = 'id') => {
                const existing = new Set(target.map(i => i[key]));
                (source || []).forEach(item => {
                    if (!existing.has(item[key])) target.push(item);
                });
            };
            
            mergeArray(this.data.chapters, importedData.chapters || importedData.data?.chapters);
            mergeArray(this.data.synopsis, importedData.synopsis || importedData.data?.synopsis);
            mergeArray(this.data.announcements, importedData.announcements || importedData.data?.announcements);
            
            (importedData.camps || importedData.data?.camps || []).forEach(camp => {
                if (!this.data.camps.includes(camp)) this.data.camps.push(camp);
            });
            
            if (importedData.settings) {
                this.data.settings = { ...this.data.settings, ...importedData.settings };
            }
            
            // 4. 保存到 GitHub
            await this.saveData();
            
            const msg = [
                `导入成功！`,
                `新增 ${addedCount} 个词条${skipCount > 0 ? `（跳过 ${skipCount} 个重复）` : ''}`,
                `上传 ${uploadedImages}/${imageFiles.length} 张图片`,
                failedImages.length > 0 ? `失败 ${failedImages.length} 张: ${failedImages.join(', ')}` : ''
            ].filter(Boolean).join('\n');
            
            this.showAlertDialog({
                title: '导入完成',
                message: msg,
                type: 'success'
            });
            
            this.updateUIForMode();
            
        } catch (error) {
            console.error('[Import] ZIP导入失败:', error);
            this.showAlertDialog({
                title: '导入失败',
                message: error.message || '无法解析ZIP文件',
                type: 'error'
            });
        }
    },
        // ========== ZIP 文件导入（新增/恢复）==========
    
    // 完整的 importZipFile 方法（替换 wiki-github-core.js 中的原有方法）
// 【完整替换】importZipFile 方法 - 修复变量重复声明和执行顺序问题
async importZipFile(zipFile, mode = 'ask', resumeFromShard = 0) {
    // 【关键修复】所有变量仅在函数开头声明一次，避免重复声明
    let uploadedCount = 0;
    let failedImages = [];
    let truncationFixed = 0;
    let addedCount = 0;
    let skipCount = 0;
    let updateCount = 0;
    let imageFiles = [];
    let uploadedFileSet = new Set(); // 【提前声明】用于后续图片引用匹配
    
    const isResuming = resumeFromShard > 0;
    const progress = this.showProgressDialog(
        isResuming ? `继续导入（从第 ${resumeFromShard} 批开始）` : '正在解析...'
    );

    try {
        // 步骤 1: 解析 ZIP
        progress.update(5, '解析ZIP文件...');
        const zip = await window.JSZip.loadAsync(zipFile);
        
        const dataFile = zip.file('data.json');
        if (!dataFile) throw new Error('ZIP中缺少 data.json');
        
        const dataText = await dataFile.async('string');
        const importedData = JSON.parse(dataText);
        const entries = importedData.entries || importedData.data?.entries || [];
        
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new Error('没有可导入的词条');
        }

        // 步骤 2: 提取图片文件列表
        imageFiles = Object.keys(zip.files).filter(name => {
            const file = zip.files[name];
            return !file.dir && (
                name.endsWith('.jpg') || 
                name.endsWith('.jpeg') || 
                name.endsWith('.png') || 
                name.endsWith('.gif') ||
                name.endsWith('.webp')
            );
        });
        console.log(`[Import] 发现 ${imageFiles.length} 张图片`);

        // 步骤 3: 模式选择
        if (mode === 'ask' && !isResuming) {
            progress.hide();
            const userChoice = await this.showImportModeDialog();
            if (userChoice === 'cancel') {
                progress.close();
                return;
            }
            mode = userChoice;
            progress.show();
        }

        // 步骤 4: 初始化数据（仅首次）
        if (!isResuming) {
            progress.update(10, mode === 'replace' ? '清空现有数据...' : '准备合并...');
            
            if (mode === 'replace') {
                this.initDefaultData();
                this.data.backendLoggedIn = this.backendLoggedIn;
                this.data.runMode = this.runMode;
            }
            
            // 合并设置
            const settings = importedData.settings || {
                name: importedData.wikiTitle,
                subtitle: importedData.wikiSubtitle,
                welcomeTitle: importedData.welcomeTitle,
                welcomeSubtitle: importedData.welcomeSubtitle
            };
            this.data.settings = { ...this.data.settings, ...settings };

            // 【关键】合并 homeContent
            const importedHomeContent = importedData.homeContent || importedData.data?.homeContent || [];
            console.log(`[Import] 发现 homeContent: ${importedHomeContent.length} 项`);
            
            if (mode === 'replace') {
                this.data.homeContent = importedHomeContent;
            } else {
                const existingKeys = new Set(this.data.homeContent.map(i => 
                    i.entryId || i.content?.substring(0, 20) || Math.random()
                ));
                importedHomeContent.forEach(item => {
                    const key = item.entryId || item.content?.substring(0, 20);
                    if (!existingKeys.has(key)) {
                        this.data.homeContent.push(item);
                        existingKeys.add(key);
                    }
                });
            }

            // 【关键】合并 synopsis
            const importedSynopsis = importedData.synopsis || importedData.data?.synopsis || [];
            if (mode === 'replace') {
                this.data.synopsis = importedSynopsis;
            } else {
                const existingSynMap = {};
                this.data.synopsis.forEach(s => { if(s.chapterId) existingSynMap[s.chapterId] = s; });
                
                importedSynopsis.forEach(syn => {
                    if (!syn.chapterId) return;
                    if (!existingSynMap[syn.chapterId]) {
                        this.data.synopsis.push(syn);
                        existingSynMap[syn.chapterId] = syn;
                    } else {
                        const existing = existingSynMap[syn.chapterId];
                        if (syn.content?.trim() && !syn.content.includes('暂无内容')) {
                            existing.content = syn.content;
                        }
                        if (syn.image && syn.image.includes('IMG:')) {
                            existing.image = syn.image;
                        }
                    }
                });
            }

            // 合并其他数据
            const mergeArray = (target, source, key = 'id') => {
                if (!source) return;
                const existing = new Set(target.map(i => i[key]));
                source.forEach(item => {
                    if (!existing.has(item[key])) target.push(item);
                });
            };
            
            mergeArray(this.data.chapters, importedData.chapters || importedData.data?.chapters);
            mergeArray(this.data.camps, importedData.camps || importedData.data?.camps);
            mergeArray(this.data.announcements, importedData.announcements || importedData.data?.announcements);

            // 导入后立即同步剧情梗概与章节
            this.syncSynopsisWithChapters();
        }

        // 【关键修复】步骤 4.5: 先处理图片上传，填充 uploadedFileSet
        progress.update(35, `正在上传 ${imageFiles.length} 张图片...`);
        
        for (const imgPath of imageFiles) {
            let filename = imgPath.replace(/^images\//, '').replace(/^\/?/, '');
            
            // 预防性修复：.jp → .jpg
            if (filename.endsWith('.jp') && !filename.endsWith('.jpg')) {
                filename += 'g';
                truncationFixed++;
            }
            
            try {
                const arrayBuffer = await zip.file(imgPath).async('arraybuffer');
                const blob = new Blob([arrayBuffer]);
                
                const dataUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.readAsDataURL(blob);
                });
                
                // 压缩并上传
                const compressed = await this.compressImageIfNeeded(dataUrl, 1920, 1080, 0.85, 2);
                await this.githubStorage.saveImage(filename, compressed);
                uploadedCount++;
                uploadedFileSet.add(filename); // 【关键】记录成功上传的文件
                
            } catch (e) {
                console.warn(`[Import] 图片上传失败 ${filename}:`, e);
                failedImages.push(filename);
            }
            
            // 每5张图片更新一次进度
            if (uploadedCount % 5 === 0) {
                progress.update(35 + (20 * uploadedCount / imageFiles.length), `已上传 ${uploadedCount}/${imageFiles.length} 张...`);
            }
        }

        console.log(`[Import] 图片上传完成: ${uploadedCount} 成功, ${failedImages.length} 失败`);

        // 【关键修复】步骤 5: 图片引用处理三部曲（现在 uploadedFileSet 已就绪）

        // 5.1 建立 {{IMG:...}} 引用（第一段控制台代码逻辑）
        progress.update(55, '建立图片引用映射...');
        entries.forEach(entry => {
            if (!entry.versions) return;
            entry.versions.forEach(v => {
                // 强制初始化 images 对象
                if (!v.images || typeof v.images !== 'object') {
                    v.images = { avatar: null, card: null, cover: null };
                }
                
                // 清除旧的无效数据（base64/blob）
                ['avatar', 'card', 'cover'].forEach(type => {
                    const val = v.images[type];
                    if (val && (val.startsWith('data:') || val.startsWith('blob:'))) {
                        v.images[type] = null;
                    }
                });
                
                // 匹配远程文件建立引用
                const patterns = {
                    avatar: `${entry.id}_${v.vid}_avatar.jpg`,
                    card: `${entry.id}_${v.vid}_card.jpg`,
                    cover: `${entry.id}_${v.vid}_cover.jpg`
                };
                
                ['avatar', 'card', 'cover'].forEach(type => {
                    const expectedFile = patterns[type];
                    if (uploadedFileSet.has(expectedFile)) {
                        v.images[type] = `{{IMG:${expectedFile}}`;
                        console.log(`[Import] 建立引用: ${entry.code} -> ${expectedFile}`);
                    }
                });
                
                // 同步旧版 image 字段
                v.image = v.images.card || v.images.avatar || v.images.cover || v.image;
            });
        });

        // 5.2 解析为完整 URL（第二段控制台代码逻辑）
        progress.update(60, '解析图片引用...');
        this.resolveImageReferences();

        // 5.3 深度修复截断（第三段控制台代码逻辑）
        progress.update(65, '检查文件名截断...');
        let deepFixed = 0;
        entries.forEach(entry => {
            if (!entry.versions) return;
            entry.versions.forEach(v => {
                if (!v.images) return;
                
                ['avatar', 'card', 'cover'].forEach(type => {
                    let val = v.images[type];
                    if (!val || typeof val !== 'string') return;
                    
                    let original = val;
                    let changed = false;
                    
                    // 场景1: URL 以 .jp 结尾
                    if (val.endsWith('.jp') && !val.endsWith('.jpg')) {
                        val = val + 'g';
                        changed = true;
                    }
                    // 场景2: {{IMG:...}} 内被截断
                    else if (val.includes('{{IMG:') && val.endsWith('.jp}}')) {
                        val = val.slice(0, -5) + '.jpg}}';
                        changed = true;
                    }
                    // 场景3: 中间截断
                    else if (val.includes('.jp/') || val.includes('.jp?') || /\.jp[^a-z]/.test(val)) {
                        val = val.replace(/\.jp([^a-z]|$)/g, '.jpg$1');
                        changed = true;
                    }
                    
                    if (changed) {
                        v.images[type] = val;
                        deepFixed++;
                        console.log(`[Import] 修复截断: ${entry.code}.${type}`);
                    }
                });
                
                // 重新同步
                v.image = v.images?.card || v.images?.avatar || v.images?.cover || v.image;
            });
        });

        if (deepFixed > 0) {
            console.log(`[Import] 深度修复了 ${deepFixed} 处截断`);
            this.resolveImageReferences(); // 重新解析
        }

        // 处理 synopsis 图片引用
        if (importedData.synopsis) {
            importedData.synopsis.forEach(syn => {
                if (!syn.image || syn.image.startsWith('data:')) {
                    const synPattern = `synopsis-${syn.chapterId || syn.id}`;
                    const possibleFiles = Array.from(uploadedFileSet).filter(f => 
                        f.startsWith(synPattern) && f.endsWith('.jpg')
                    );
                    if (possibleFiles.length > 0) {
                        syn.image = `{{IMG:${possibleFiles[0]}}`;
                    }
                }
            });
        }

        // 步骤 6: 合并 entries
        progress.update(75, '合并词条数据...');
        const existingIds = new Set(this.data.entries.map(e => e.id));
        
        for (const entry of entries) {
            if (!existingIds.has(entry.id)) {
                // 清理内嵌 base64
                if (entry.versions) {
                    entry.versions.forEach(v => {
                        if (v.image && v.image.startsWith('data:')) v.image = null;
                        if (v.images) {
                            Object.keys(v.images).forEach(k => {
                                if (v.images[k] && v.images[k].startsWith('data:')) v.images[k] = null;
                            });
                        }
                    });
                }
                this.data.entries.push(entry);
                existingIds.add(entry.id);
                addedCount++;
            // 【修正】完整替换 merge-update 逻辑块（注意 else if 语法）
            } else if (mode === 'merge-update') {
                // 智能合并：追加新版本 + 更新已变更的旧版本
                const existingIndex = this.data.entries.findIndex(e => e.id === entry.id);
                if (existingIndex >= 0 && entry.versions) {
                    const existingEntry = this.data.entries[existingIndex];
                    const existingVersions = existingEntry.versions || [];
                    
                    entry.versions.forEach(newVersion => {
                        const existingVersionIndex = existingVersions.findIndex(v => v.vid === newVersion.vid);
                        
                        if (existingVersionIndex === -1) {
                            // 情况1：全新版本，追加
                            existingVersions.push(newVersion);
                            addedCount++;
                        } else {
                            // 情况2：版本已存在，检查内容是否变化
                            const oldVersion = existingVersions[existingVersionIndex];
                            const hasChanged = this.hasVersionContentChanged(oldVersion, newVersion);
                            
                            if (hasChanged) {
                                // 保留创建时间，更新内容字段，添加更新时间戳
                                const createdAt = oldVersion.createdAt || Date.now();
                                Object.assign(existingVersions[existingVersionIndex], newVersion, {
                                    createdAt: createdAt,      // 保留原始创建时间
                                    updatedAt: Date.now()      // 标记更新时间
                                });
                                updateCount++;
                                console.log(`[Import] 更新版本 ${entry.code}/${newVersion.vid}: 内容已变更`);
                            }
                        }
                    });
                } else if (existingIndex === -1) {
                    // 情况3：全新条目，直接添加
                    this.data.entries.push(entry);
                    addedCount++;
                }
                // 【关键】保留 else 分支，即使为空也要有，确保语法完整
            } else {
                // 默认逻辑（保底）
                skipCount++;
            }
        }

        // 【关键】确保时间节点数据存在并初始化
        this.data.timelineNodes = this.data.timelineNodes || [];
        this.data.newReaderNodeId = this.data.newReaderNodeId || null;
        this.data.latestNodeId = this.data.latestNodeId || null;
        this.ensureDefaultNodes(); // 【确保】在此处调用

        console.log(`[Import] 条目统计: 新增 ${addedCount}, 跳过 ${skipCount}, 更新 ${updateCount}`);

        // 步骤 7: 保存数据（分片保存逻辑）
        progress.update(85, '正在保存数据...');
        
        // 【关键保护】保存前强制检查数据完整性
        const entriesToSave = this.data.entries || [];
        if (entriesToSave.length === 0) {
            console.error('[Import] ❌ 保存前检测到条目为空，中止保存！');
            throw new Error('数据完整性检查失败：entries 为空，可能是合并过程中数据被意外清空');
        }
        
        // 【关键保护】确保所有必要字段存在（防止后续渲染报错）
        this.data.timelineNodes = this.data.timelineNodes || [];
        this.data.newReaderNodeId = this.data.newReaderNodeId || null;
        this.data.latestNodeId = this.data.latestNodeId || null;
        this.ensureDefaultNodes();
        
        const ENTRIES_PER_FILE = 20;
        const totalEntries = entriesToSave.length;
        const totalShards = Math.ceil(totalEntries / ENTRIES_PER_FILE);
        
        // 构建基础数据（包含所有非条目数据）
        const baseData = {
            version: '2.7.0-sharded',
            lastUpdate: Date.now(),
            totalEntries: totalEntries,
            entryFiles: [],
            settings: this.data.settings || {},
            chapters: this.data.chapters || [],
            camps: this.data.camps || [],
            synopsis: this.data.synopsis || [],
            announcements: this.data.announcements || [],
            homeContent: this.data.homeContent || [],
            customFields: this.data.customFields || {},
            timelineNodes: this.data.timelineNodes || [],
            newReaderNodeId: this.data.newReaderNodeId,
            latestNodeId: this.data.latestNodeId
        };

        // 【关键修复1】先保存基础结构（使用15次重试+初始延迟，应对409冲突）
        let baseSaved = false;
        for (let retry = 0; retry < 3; retry++) {
            try {
                // 首次尝试前等待，避免与之前操作冲突
                if (retry === 0) await new Promise(r => setTimeout(r, 2000));
                
                await this.githubStorage.putFile(
                    'data.json', 
                    JSON.stringify(baseData, null, 2), 
                    'Update index structure',
                    false,
                    15 // 强制15次重试
                );
                baseSaved = true;
                console.log('[Import] ✅ 基础索引已保存');
                break;
            } catch (e) {
                console.warn(`[Import] 基础索引保存尝试 ${retry + 1}/3 失败:`, e.message);
                if (retry === 2) {
                    throw new Error('基础索引保存失败（409冲突过多），建议等待1分钟后重试');
                }
                await new Promise(r => setTimeout(r, 5000 * (retry + 1))); // 递增延迟
            }
        }

        // 分片保存 entries（带批次间延迟）
        let savedShards = 0;
        let failedShards = [];
        
        for (let i = 0; i < totalEntries; i += ENTRIES_PER_FILE) {
            const shard = entriesToSave.slice(i, i + ENTRIES_PER_FILE);
            const shardIndex = Math.floor(i / ENTRIES_PER_FILE);
            const fileName = `entries-${shardIndex}.json`;
            
            let shardSaved = false;
            
            // 【关键修复2】批次间延迟（1000ms），避免GitHub API限流和409冲突
            if (i > 0) {
                await new Promise(r => setTimeout(r, 1000));
            }
            
            // 每个分片独立重试3次
            for (let retry = 0; retry < 3; retry++) {
                try {
                    await this.githubStorage.putFile(
                        fileName, 
                        JSON.stringify(shard, null, 2), 
                        `Update entries batch ${shardIndex} (${i}-${Math.min(i + ENTRIES_PER_FILE, totalEntries)})`
                    );
                    
                    savedShards++;
                    shardSaved = true;
                    baseData.entryFiles.push(fileName);
                    break;
                    
                } catch (e) {
                    console.warn(`[Import] 分片 ${fileName} 尝试 ${retry + 1}/3 失败:`, e.message);
                    if (retry < 2) {
                        // 分片失败等待时间递增
                        await new Promise(r => setTimeout(r, 3000 * (retry + 1)));
                    }
                }
            }
            
            if (!shardSaved) {
                failedShards.push(fileName);
                console.error(`[Import] ❌ 分片 ${fileName} 最终失败`);
                // 【关键保护】即使分片失败，也记录文件名以便后续手动修复
                baseData.entryFiles.push(fileName);
            }
            
            // 更新进度：85% ~ 95%
            progress.update(
                85 + (10 * (shardIndex + 1) / totalShards), 
                `保存批次 ${shardIndex + 1}/${totalShards} (${Math.min(i + ENTRIES_PER_FILE, totalEntries)}/${totalEntries})...`
            );
        }

        // 【关键修复3】最终索引保存前强制延迟，确保GitHub缓存已更新
        progress.update(95, '最终确认中...');
        await new Promise(r => setTimeout(r, 5000)); // 5秒延迟，确保所有分片可访问
        
        // 标记失败的分片（如果有）
        if (failedShards.length > 0) {
            baseData.failedShards = failedShards;
            baseData.lastUpdate = Date.now();
            console.warn(`[Import] ⚠️ 标记 ${failedShards.length} 个失败分片`);
        }

        // 【关键修复4】使用15次重试保存最终索引
        let finalSaved = false;
        for (let retry = 0; retry < 3; retry++) {
            try {
                await this.githubStorage.putFile(
                    'data.json', 
                    JSON.stringify(baseData, null, 2), 
                    'Import complete',
                    false,
                    15
                );
                finalSaved = true;
                console.log('[Import] ✅ 最终索引已保存');
                break;
            } catch (e) {
                console.warn(`[Import] 最终索引尝试 ${retry + 1}/3 失败:`, e.message);
                if (retry === 2) {
                    // 【关键保护】最终索引失败不抛出错误，因为分片数据已保存
                    console.error('[Import] ⚠️ 最终索引保存失败，但分片数据已保存，可手动修复');
                    // 保存进度到 localStorage 以便恢复
                    localStorage.setItem('wiki_import_recovery', JSON.stringify({
                        baseData: baseData,
                        failedShards: failedShards,
                        timestamp: Date.now()
                    }));
                }
                await new Promise(r => setTimeout(r, 10000 * (retry + 1))); // 更长延迟
            }
        }

        // 完成
        progress.update(100, '导入完成！');
        localStorage.removeItem('wiki_import_progress');
        setTimeout(() => progress.close(), 500);

        // 构建结果消息
        const msgLines = [
            `导入完成！`,
            `条目: +${addedCount} 新, 跳过 ${skipCount}${updateCount > 0 ? `, 更新 ${updateCount}` : ''}`,
            `图片: ${uploadedCount}/${imageFiles.length} 成功${failedImages.length > 0 ? `, ${failedImages.length} 失败` : ''}`,
            deepFixed > 0 ? `（修复 ${deepFixed} 处截断）` : ''
        ].filter(Boolean);
        
        this.showAlertDialog({
            title: '导入成功',
            message: msgLines.join('\n'),
            type: 'success'
        });

        // 刷新显示
        this.resolveImageReferences();
        this.router(this.data.currentTarget || 'home', false);
        
        // 延迟二次刷新确保GitHub Raw生效
        setTimeout(() => {
            this.resolveImageReferences();
            this.router(this.data.currentTarget || 'home', false);
        }, 1000);

        // 重新加载验证
        await this.loadDataFromGitHub();
        
    } catch (error) {
        progress.close();
        console.error('[Import] 失败:', error);
        
        // 【关键修复】智能合并模式下也能正确保存进度
        // 计算当前应该所在的批次（估算）
        let currentBatch = 0;
        const totalEntries = (importedData.entries || importedData.data?.entries || []).length;
        const ENTRIES_PER_FILE = 20;
        const totalBatches = Math.ceil(totalEntries / ENTRIES_PER_FILE) + 1;
        
        // 如果错误发生在分片保存阶段，尝试从错误信息中解析批次
        // 或者根据 entries 数量估算：假设已经成功保存了 80% 的 entries
        if (this.data.entries && this.data.entries.length > 0) {
            const savedCount = this.data.entries.length - totalEntries; // 已存在的条目数
            if (savedCount > 0) {
                currentBatch = Math.floor(savedCount / ENTRIES_PER_FILE);
            }
        }
        
        // 询问是否保存进度
        if (confirm(`导入失败: ${error.message}\n\n是否保存进度以便稍后继续？\n（当前约在第 ${currentBatch}/${totalBatches} 批次）`)) {
            localStorage.setItem('wiki_import_progress', JSON.stringify({
                filename: zipFile.name,
                batchIndex: currentBatch,
                totalBatches: totalBatches,
                mode: mode, // 【关键】确保保存模式
                dataPath: this.githubStorage?.config?.dataPath || 'wiki-data',
                timestamp: Date.now()
            }));
            this.showToast('进度已保存，请刷新页面后选择相同文件继续', 'info', 5000);
        } else {
            localStorage.removeItem('wiki_import_progress');
        }
    }
},

// 【新增】简化的保存方法（非分片，确保数据完整性）
async saveDataSimple(progress = null) {
    try {
        console.log('[Wiki] 使用简化保存模式...');
        
        // 清理数据中的base64图片，避免体积过大
        const cleanData = JSON.parse(JSON.stringify(this.data));
        cleanData.entries.forEach(entry => {
            if (entry.versions) {
                entry.versions.forEach(v => {
                    if (v.image && v.image.startsWith('data:')) v.image = null;
                    if (v.images) {
                        Object.keys(v.images).forEach(k => {
                            if (v.images[k] && v.images[k].startsWith('data:')) v.images[k] = null;
                        });
                    }
                });
            }
        });
        
        // 添加版本标记（非分片）
        cleanData.version = '2.7.0-atomic';
        cleanData.lastUpdate = Date.now();
        cleanData.entryFiles = null; // 标记为非分片
        
        const content = JSON.stringify(cleanData, null, 2);
        
        if (progress) progress.update(85, '写入主数据文件...');
        
        // 使用简单保存（非分片）
        await this.githubStorage.putFile('data.json', content, 'Update Wiki data (atomic)', false, 10);
        
        if (progress) progress.update(90, '验证保存结果...');
        
        // 验证保存成功
        await new Promise(r => setTimeout(r, 1000)); // 等待GitHub缓存
        const verify = await this.githubStorage.getFile('data.json');
        if (!verify || !verify.content) {
            throw new Error('保存验证失败：无法读取回数据');
        }
        
        return { success: true };
        
    } catch (error) {
        console.error('[SaveSimple] 保存失败:', error);
        return { success: false, error: error.message };
    }
},
// 【添加到 app 对象】数据修复工具
fixData: async function() {
    console.log('[Fix] 开始数据修复...');
    
    // 1. 重新解析所有图片引用
    console.log('[Fix] 重新解析图片引用...');
    this.resolveImageReferences();
    
    // 2. 同步剧情梗概
    console.log('[Fix] 同步剧情梗概...');
    this.syncSynopsisWithChapters();
    
    // 3. 检查条目完整性
    let brokenEntries = 0;
    this.data.entries.forEach(entry => {
        if (!entry.versions || entry.versions.length === 0) {
            brokenEntries++;
            console.warn(`[Fix] 发现无版本条目: ${entry.id}`);
        }
    });
    
    // 4. 保存修复后的数据
    console.log('[Fix] 保存修复结果...');
    try {
        await this.saveDataAtomic();
        console.log('[Fix] ✅ 修复完成并已保存');
        this.showToast('数据修复完成', 'success');
        
        // 刷新页面显示
        this.router('home');
    } catch (e) {
        console.error('[Fix] 保存失败:', e);
        this.showToast('修复保存失败: ' + e.message, 'error');
    }
    
    return {
        entries: this.data.entries.length,
        homeContent: this.data.homeContent.length,
        synopsis: this.data.synopsis.length,
        brokenEntries: brokenEntries
    };
},
// 【新增】检查并恢复导入进度（页面加载时调用）
// 【替换】checkImportResume 方法（确保恢复时能正确传递 mode）
checkImportResume: async function() {
    const saved = localStorage.getItem('wiki_import_progress');
    if (!saved) return;
    
    try {
        const progress = JSON.parse(saved);
        
        // 检查是否超过 24 小时
        if (Date.now() - progress.timestamp > 24 * 60 * 60 * 1000) {
            localStorage.removeItem('wiki_import_progress');
            return;
        }
        
        // 【关键修复】确保有 mode 字段，默认为 merge-update（智能合并）
        const savedMode = progress.mode || 'merge-update';
        const batchInfo = progress.batchIndex > 0 ? `（从第 ${progress.batchIndex} 批次继续）` : '';
        
        // 提示用户
        if (confirm(`检测到未完成的导入: ${progress.filename}\n模式: ${savedMode === 'replace' ? '完全覆盖' : '智能合并'}\n进度: ${progress.batchIndex || 0}/${progress.totalBatches || '?'} 批次${batchInfo}\n\n是否继续导入？\n\n点击"确定"将要求您重新选择同一文件`)) {
            // 重新选择文件继续
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.zip';
            input.onchange = (e) => {
                if (e.target.files[0]) {
                    // 【关键】传递恢复参数：mode 和 resumeFromShard
                    this.importZipFile(e.target.files[0], savedMode, progress.batchIndex || 0);
                }
            };
            input.click();
        } else {
            localStorage.removeItem('wiki_import_progress');
            this.showToast('已清除导入进度', 'info');
        }
    } catch (e) {
        console.error('[Resume] 恢复失败:', e);
        localStorage.removeItem('wiki_import_progress');
    }
},

// 【必需】图片压缩方法（如果之前没添加）
compressImageIfNeeded: function(dataUrl, maxWidth = 1920, maxHeight = 1080, quality = 0.85, maxSizeMB = 3) {
    return new Promise((resolve) => {
        // 估算大小
        const base64Length = dataUrl.length - (dataUrl.indexOf(',') + 1 || 0);
        const sizeInMB = (base64Length * 0.75) / 1024 / 1024;
        
        // 如果小于阈值，直接返回
        if (sizeInMB < maxSizeMB && !dataUrl.includes('image/gif')) {
            resolve(dataUrl);
            return;
        }

        console.log(`[Compress] 图片 ${sizeInMB.toFixed(2)}MB，开始压缩...`);
        
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            
            // 计算缩放比例
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.floor(width * ratio);
                height = Math.floor(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // 转换为 JPEG
            let compressed = canvas.toDataURL('image/jpeg', quality);
            const newSize = ((compressed.length) * 0.75) / 1024 / 1024;
            
            // 如果仍然太大，进一步压缩
            if (newSize > maxSizeMB && quality > 0.5) {
                compressed = canvas.toDataURL('image/jpeg', quality - 0.15);
                console.log(`[Compress] 二次压缩至 ${((compressed.length)*0.75/1024/1024).toFixed(2)}MB`);
            }
            
            resolve(compressed);
        };
        
        img.onerror = () => {
            console.warn('[Compress] 图片加载失败，使用原图');
            resolve(dataUrl);
        };
        
        img.src = dataUrl;
    });
},

    // 【必需】辅助方法：合并或替换数组
    mergeOrReplaceArray: function(fieldName, newItems, mode, unique = false) {
        if (!newItems || newItems.length === 0) return;
        
        if (mode === 'replace') {
            this.data[fieldName] = newItems;
            return;
        }
        
        // 合并模式
        const existing = this.data[fieldName] || [];
        const existingIds = new Set(existing.map(i => i.id || i));
        
        for (const item of newItems) {
            const itemId = item.id || item;
            if (!existingIds.has(itemId)) {
                existing.push(item);
                if (unique) existingIds.add(itemId);
            } else if (!unique && item.id) {
                // 对于对象数组，更新已存在的项
                const idx = existing.findIndex(e => e.id === item.id);
                if (idx !== -1) existing[idx] = item;
            }
        }
        
        this.data[fieldName] = existing;
    },

    // 【新增】获取系统配置（导入时保留）
    getSystemConfig: function() {
        return {
            backendLoggedIn: this.backendLoggedIn,
            backendPassword: this.backendPassword,
            runMode: this.runMode,
            githubStorage: this.githubStorage ? {
                config: this.githubStorage.config
            } : null
        };
    },

    // 【新增】导入模式选择对话框
    showImportModeDialog: function() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
            overlay.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                    <div class="text-center mb-6">
                        <div class="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <i class="fa-solid fa-file-import text-indigo-600 text-2xl"></i>
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">选择导入模式</h3>
                        <p class="text-gray-600 text-sm">检测到存档文件，请选择如何处理现有数据</p>
                    </div>
                    
                    <div class="space-y-3 mb-6">
                        <button id="mode-replace" class="w-full p-4 border-2 border-indigo-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition text-left group">
                            <div class="flex items-center gap-3">
                                <i class="fa-solid fa-rotate text-indigo-600 text-xl"></i>
                                <div>
                                    <div class="font-bold text-gray-800 group-hover:text-indigo-700">完全覆盖</div>
                                    <div class="text-xs text-gray-500">清空现有数据，使用存档完全替换</div>
                                </div>
                            </div>
                        </button>
                        
                        <button id="mode-merge" class="w-full p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition text-left group">
                            <div class="flex items-center gap-3">
                                <i class="fa-solid fa-code-merge text-gray-600 text-xl group-hover:text-indigo-600"></i>
                                <div>
                                    <div class="font-bold text-gray-800 group-hover:text-indigo-700">智能合并</div>
                                    <div class="text-xs text-gray-500">保留现有数据，更新相同ID的条目，添加新条目</div>
                                </div>
                            </div>
                        </button>
                    </div>
                    
                    <button id="mode-cancel" class="w-full py-2 text-gray-500 hover:text-gray-700 text-sm">
                        取消导入
                    </button>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            overlay.querySelector('#mode-replace').onclick = () => {
                overlay.remove();
                resolve('replace');
            };
            overlay.querySelector('#mode-merge').onclick = () => {
                overlay.remove();
                resolve('merge');
            };
            overlay.querySelector('#mode-cancel').onclick = () => {
                overlay.remove();
                resolve('cancel');
            };
            
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve('cancel');
                }
            };
        });
    },

    showImportStatus(message, type) {
        const statusEl = document.getElementById('import-status');
        if (!statusEl) return;

        statusEl.classList.remove('hidden', 'bg-green-100', 'text-green-700', 'bg-red-100', 'text-red-700', 'bg-blue-100', 'text-blue-700');

        const colors = {
            success: ['bg-green-100', 'text-green-700'],
            error: ['bg-red-100', 'text-red-700'],
            info: ['bg-blue-100', 'text-blue-700']
        };

        statusEl.classList.add(...(colors[type] || colors.info));
        statusEl.textContent = message;
    },

    // 处理 data.json 中的内嵌图片（提取并替换为引用）
    extractEmbeddedImages: async function(data) {
        let imageCount = 0;
        const entries = data.entries || [];
        
        for (const entry of entries) {
            if (!entry.versions) continue;
            
            for (const version of entry.versions) {
                // 处理旧版单个 image 字段
                if (version.image && version.image.startsWith('data:image')) {
                    try {
                        const compressed = await this.compressImageIfNeeded(version.image);
                        const imgName = `${entry.id}_${version.vid}_image.jpg`;
                        await this.githubStorage.saveImage(imgName, compressed);
                        version.image = `{{IMG:${imgName}}`;
                        imageCount++;
                        console.log(`[Extract] 提取条目 ${entry.code} 的内嵌图片`);
                    } catch (e) {
                        console.warn(`[Extract] 提取失败，移除内嵌图片:`, e.message);
                        version.image = null; // 失败则移除，避免 data.json 过大
                    }
                }
            }
        }
        
        return { data, imageCount };
    },
    // ========== 时间节点管理 ==========
    renderTimelineNodes(container) {
        const tpl = document.getElementById('tpl-timeline-nodes');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        // 填充特殊节点选择器
        const newReaderSelect = document.getElementById('new-reader-node');
        const latestSelect = document.getElementById('latest-node');
        
        // 清空并重建选项（保留默认空选项）
        newReaderSelect.innerHTML = '<option value="">-- 未设置 --</option>';
        latestSelect.innerHTML = '<option value="">-- 自动（最后节点）--</option>';
        
        const sorted = [...this.data.timelineNodes].sort((a, b) => a.order - b.order);
        sorted.forEach(node => {
            const opt1 = new Option(node.name, node.id);
            const opt2 = new Option(node.name, node.id);
            if (node.id === this.data.newReaderNodeId) opt1.selected = true;
            if (node.id === this.data.latestNodeId) opt2.selected = true;
            newReaderSelect.add(opt1);
            latestSelect.add(opt2);
        });
        
        // 保存特殊节点选择
        newReaderSelect.onchange = (e) => {
            this.data.newReaderNodeId = e.target.value || null;
            this.renderNodeList(document.getElementById('timeline-nodes-list'));
        };
        latestSelect.onchange = (e) => {
            this.data.latestNodeId = e.target.value || null;
            this.renderNodeList(document.getElementById('timeline-nodes-list'));
        };
        
        // 渲染节点列表
        const list = document.getElementById('timeline-nodes-list');
        this.renderNodeList(list);
    },

    renderNodeList(container) {
        if (!container) return;
        container.innerHTML = '';
        const sorted = [...this.data.timelineNodes].sort((a, b) => a.order - b.order);
        
        sorted.forEach((node, idx) => {
            const item = document.createElement('div');
            item.className = 'flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 shadow-sm';
            item.draggable = true;
            item.dataset.nodeId = node.id;
            
            const isNewReader = node.id === this.data.newReaderNodeId;
            const isLatest = node.id === this.data.latestNodeId;
            const badges = [
                isNewReader ? '<span class="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded mr-1">起点</span>' : '',
                isLatest ? '<span class="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded">最新</span>' : ''
            ].join('');
            
            item.innerHTML = `
                <div class="cursor-move text-gray-400 hover:text-gray-600 p-1">
                    <i class="fa-solid fa-grip-vertical"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <span class="font-bold text-gray-800">${node.name}</span>
                        ${badges}
                    </div>
                    <div class="text-xs text-gray-500">
                        包含 ${node.entries?.length || 0} 个词条版本 · 顺序 ${node.order}
                    </div>
                </div>
                <div class="flex gap-1">
                    <button onclick="app.editTimelineNode('${node.id}')" class="p-2 text-purple-600 hover:bg-purple-50 rounded" title="配置词条">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button onclick="app.deleteTimelineNode('${node.id}')" class="p-2 text-red-600 hover:bg-red-50 rounded" title="删除">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            
            // 拖拽事件
            item.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', node.id);
                item.style.opacity = '0.5';
            };
            item.ondragend = () => {
                item.style.opacity = '1';
            };
            item.ondragover = (e) => {
                e.preventDefault();
                item.style.borderTop = '2px solid #9333ea';
            };
            item.ondragleave = () => {
                item.style.borderTop = '';
            };
            item.ondrop = (e) => {
                e.preventDefault();
                item.style.borderTop = '';
                const draggedId = e.dataTransfer.getData('text/plain');
                if (draggedId !== node.id) {
                    this.reorderTimelineNodes(draggedId, node.id);
                }
            };
            
            container.appendChild(item);
        });
        
        if (sorted.length === 0) {
            container.innerHTML = '<div class="text-center py-8 text-gray-400 text-sm">暂无时间节点，点击右上角"添加节点"创建</div>';
        }
    },

    addTimelineNode() {
        this.showPromptDialog({
            title: '新建时间节点',
            message: '输入节点名称（如"第一卷·初入江湖"）：',
            confirmText: '创建',
            cancelText: '取消'
        }).then(name => {
            if (!name || !name.trim()) return;
            
            const newNode = {
                id: 'node-' + Date.now(),
                name: name.trim(),
                order: this.data.timelineNodes.length,
                entries: [] // 每个元素：{entryId, versionId, pinned}
            };
            
            this.data.timelineNodes.push(newNode);
            
            // 如果是第一个节点，自动设为默认
            if (this.data.timelineNodes.length === 1) {
                this.data.newReaderNodeId = newNode.id;
                this.data.latestNodeId = newNode.id;
            }
            
            this.renderNodeList(document.getElementById('timeline-nodes-list'));
            this.showToast('节点已创建，请配置包含的词条', 'success');
        });
    },

    deleteTimelineNode(nodeId) {
        const node = this.data.timelineNodes.find(n => n.id === nodeId);
        if (!node) return;
        
        this.showConfirmDialog({
            title: '删除确认',
            message: `确定删除时间节点"${node.name}"？\n该节点内的词条配置将全部丢失。`,
            confirmText: '删除',
            cancelText: '取消',
            type: 'danger'
        }).then(confirmed => {
            if (confirmed) {
                this.data.timelineNodes = this.data.timelineNodes.filter(n => n.id !== nodeId);
                
                // 清理特殊节点引用
                if (this.data.newReaderNodeId === nodeId) this.data.newReaderNodeId = null;
                if (this.data.latestNodeId === nodeId) this.data.latestNodeId = null;
                
                this.renderNodeList(document.getElementById('timeline-nodes-list'));
                this.showToast('节点已删除', 'success');
            }
        });
    },

    reorderTimelineNodes(draggedId, targetId) {
        const nodes = this.data.timelineNodes;
        const draggedIdx = nodes.findIndex(n => n.id === draggedId);
        const targetIdx = nodes.findIndex(n => n.id === targetId);
        
        if (draggedIdx === -1 || targetIdx === -1) return;
        
        // 移除并插入
        const [removed] = nodes.splice(draggedIdx, 1);
        nodes.splice(targetIdx, 0, removed);
        
        // 重新计算order
        nodes.forEach((n, i) => n.order = i);
        
        this.renderNodeList(document.getElementById('timeline-nodes-list'));
    },

    editTimelineNode(nodeId) {
        this.data.editingTimelineNodeId = nodeId;
        this.router('timeline-node-edit');
    },

    renderTimelineNodeEdit(container) {
        const nodeId = this.data.editingTimelineNodeId;
        const node = this.data.timelineNodes.find(n => n.id === nodeId);
        if (!node) {
            this.showToast('节点不存在', 'error');
            this.router('timeline-nodes');
            return;
        }
        
        const tpl = document.getElementById('tpl-timeline-node-edit');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        document.getElementById('node-edit-title').textContent = `配置：${node.name}`;
        
        // 初始化可用词条过滤状态
        this._availableFilter = { type: 'all', search: '' };
        
        this.renderAvailableEntries(node);
        this.renderNodeEntries(node);
    },

    renderAvailableEntries(node) {
        const container = document.getElementById('available-entries-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        // 获取已添加的entryId+versionId组合，用于去重显示
        const addedKeys = new Set((node.entries || []).map(e => `${e.entryId}-${e.versionId}`));
        
        // 过滤词条
        let entries = this.data.entries;
        if (this._availableFilter?.type && this._availableFilter.type !== 'all') {
            entries = entries.filter(e => e.type === this._availableFilter.type);
        }
        if (this._availableFilter?.search) {
            const s = this._availableFilter.search.toLowerCase();
            entries = entries.filter(e => {
                const v = this.getVisibleVersion(e);
                return e.code.toLowerCase().includes(s) || v?.title?.toLowerCase().includes(s);
            });
        }
        
        entries.forEach(entry => {
            // 遍历该词条的所有版本，每个版本都可独立添加
            (entry.versions || []).forEach(version => {
                const key = `${entry.id}-${version.vid}`;
                if (addedKeys.has(key)) return; // 已添加的不显示
                
                const div = document.createElement('div');
                div.className = 'flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer border-b border-gray-50';
                div.onclick = () => this.addEntryToNode(node, entry.id, version.vid);
                
                const isPinned = node.entries?.find(e => e.entryId === entry.id && e.pinned);
                const pinBadge = isPinned ? '<i class="fa-solid fa-thumbtack text-amber-500 text-xs mr-1"></i>' : '';
                
                div.innerHTML = `
                    <span class="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">${entry.code}</span>
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-gray-700 truncate">${pinBadge}${version.title || '未命名'}</div>
                        <div class="text-[10px] text-gray-400">v${version.vid?.substr(-4) || 'unknown'}</div>
                    </div>
                    <i class="fa-solid fa-plus text-gray-400 text-xs"></i>
                `;
                container.appendChild(div);
            });
        });
        
        if (container.children.length === 0) {
            container.innerHTML = '<div class="text-center py-4 text-gray-400 text-xs">无可用词条或已全部添加</div>';
        }
    },

    renderNodeEntries(node) {
        const container = document.getElementById('node-entries-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!node.entries || node.entries.length === 0) {
            container.innerHTML = '<div class="text-center py-8 text-gray-400 text-xs border-2 border-dashed border-gray-200 rounded-lg">点击左侧词条添加到当前时间节点</div>';
            return;
        }
        
        // 按拖拽顺序渲染（支持拖拽排序）
        node.entries.forEach((entryConfig, idx) => {
            const entry = this.data.entries.find(e => e.id === entryConfig.entryId);
            if (!entry) return; // 词条可能已被删除
            
            const version = entry.versions?.find(v => v.vid === entryConfig.versionId);
            if (!version) return;
            
            const div = document.createElement('div');
            div.className = `flex items-center gap-2 p-3 rounded-lg border ${entryConfig.pinned ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'} mb-2`;
            div.draggable = true;
            
            div.innerHTML = `
                <div class="cursor-move text-gray-400"><i class="fa-solid fa-grip-vertical text-xs"></i></div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 rounded">${entry.code}</span>
                        <span class="text-sm font-medium text-gray-800 truncate">${version.title || '未命名'}</span>
                        ${entryConfig.pinned ? '<span class="text-[10px] bg-amber-200 text-amber-800 px-1.5 rounded">置顶</span>' : ''}
                    </div>
                </div>
                <div class="flex gap-1">
                    <button onclick="app.togglePinnedVersion('${entryConfig.entryId}', '${entryConfig.versionId}')" 
                        class="p-1.5 ${entryConfig.pinned ? 'text-amber-600 bg-amber-100' : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'} rounded"
                        title="${entryConfig.pinned ? '取消置顶' : '设为置顶版本'}">
                        <i class="fa-solid fa-thumbtack text-xs"></i>
                    </button>
                    <button onclick="app.removeEntryFromNode('${entryConfig.entryId}', '${entryConfig.versionId}')" 
                        class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="移除">
                        <i class="fa-solid fa-times text-xs"></i>
                    </button>
                </div>
            `;
            
            // 拖拽排序
            div.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', idx);
                div.style.opacity = '0.5';
            };
            div.ondragend = () => div.style.opacity = '1';
            div.ondragover = (e) => {
                e.preventDefault();
                div.style.borderTop = '2px solid #9333ea';
            };
            div.ondragleave = () => div.style.borderTop = '';
            div.ondrop = (e) => {
                e.preventDefault();
                div.style.borderTop = '';
                const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
                if (fromIdx !== idx) {
                    this.reorderNodeEntries(node, fromIdx, idx);
                }
            };
            
            container.appendChild(div);
        });
    },

    filterAvailableEntries(keyword) {
        this._availableFilter = this._availableFilter || { type: 'all', search: '' };
        this._availableFilter.search = keyword;
        const node = this.data.timelineNodes.find(n => n.id === this.data.editingTimelineNodeId);
        if (node) this.renderAvailableEntries(node);
    },

    showAvailableByType(type) {
        this._availableFilter = this._availableFilter || { type: 'all', search: '' };
        this._availableFilter.type = type;
        const node = this.data.timelineNodes.find(n => n.id === this.data.editingTimelineNodeId);
        if (node) this.renderAvailableEntries(node);
    },

    addEntryToNode(node, entryId, versionId) {
        if (!node.entries) node.entries = [];
        
        // 检查是否已存在
        const exists = node.entries.find(e => e.entryId === entryId && e.versionId === versionId);
        if (exists) {
            this.showToast('该版本已存在', 'warning');
            return;
        }
        
        // 检查该词条是否已有其他版本被添加，如果有则提示但不会阻止
        const hasOtherVersion = node.entries.find(e => e.entryId === entryId);
        if (hasOtherVersion) {
            this.showToast('已添加该角色的其他版本，可以继续添加此版本', 'info');
        }
        
        node.entries.push({
            entryId,
            versionId,
            pinned: false
        });
        
        // 重新渲染
        this.renderAvailableEntries(node);
        this.renderNodeEntries(node);
    },

    removeEntryFromNode(entryId, versionId) {
        const node = this.data.timelineNodes.find(n => n.id === this.data.editingTimelineNodeId);
        if (!node) return;
        
        node.entries = node.entries.filter(e => !(e.entryId === entryId && e.versionId === versionId));
        this.renderAvailableEntries(node);
        this.renderNodeEntries(node);
    },

    togglePinnedVersion(entryId, versionId) {
        const node = this.data.timelineNodes.find(n => n.id === this.data.editingTimelineNodeId);
        if (!node) return;
        
        const entry = node.entries.find(e => e.entryId === entryId && e.versionId === versionId);
        if (entry) {
            entry.pinned = !entry.pinned;
            this.renderNodeEntries(node);
        }
    },

    reorderNodeEntries(node, fromIdx, toIdx) {
        if (!node.entries || fromIdx < 0 || toIdx < 0 || fromIdx >= node.entries.length || toIdx >= node.entries.length) return;
        
        const [removed] = node.entries.splice(fromIdx, 1);
        node.entries.splice(toIdx, 0, removed);
        
        this.renderNodeEntries(node);
    },

    saveCurrentNodeConfig() {
        this.showToast('当前节点配置已保存（内存中），请返回后保存到GitHub', 'success');
        this.router('timeline-nodes');
    },
    showPromptDialog(options) {
        return new Promise((resolve) => {
            const { title = '输入', message, confirmText = '确认', cancelText = '取消', defaultValue = '' } = options;
            
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
            overlay.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
                    <div class="text-center mb-4">
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>
                        <p class="text-gray-600 text-sm mb-4">${message}</p>
                        <input type="text" id="prompt-input" class="w-full p-3 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" value="${defaultValue}">
                    </div>
                    <div class="flex gap-3">
                        <button id="prompt-cancel" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">
                            ${cancelText}
                        </button>
                        <button id="prompt-ok" class="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition font-medium shadow-lg">
                            ${confirmText}
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            const input = overlay.querySelector('#prompt-input');
            input.focus();
            input.select();
            
            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    overlay.querySelector('#prompt-ok').click();
                }
            };
            
            overlay.querySelector('#prompt-cancel').onclick = () => {
                overlay.remove();
                resolve(null);
            };
            
            overlay.querySelector('#prompt-ok').onclick = () => {
                const value = input.value.trim();
                overlay.remove();
                resolve(value);
            };
            
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(null);
                }
            };
        });
    },
    async saveTimelineNodes() {
        try {
            await this.saveData();
            this.showToast('时间节点配置已保存到GitHub', 'success');
        } catch (error) {
            this.showAlertDialog({
                title: '保存失败',
                message: '无法保存时间节点配置：' + error.message,
                type: 'error'
            });
        }
    },
    // ========== 分享码管理 ==========
    async generateShareCode() {
        const codeInput = document.getElementById('new-share-code');
        const descInput = document.getElementById('share-code-desc');
        
        let code = codeInput.value.trim().toUpperCase();
        if (!code) {
            code = this.shareCodeSystem.generateCode();
        }
        
        if (!this.shareCodeSystem.validateCode(code)) {
            this.showAlertDialog({
                title: '格式错误',
                message: '分享码应为8位字母数字组合',
                type: 'warning'
            });
            return;
        }
        
        const success = await this.shareCodeSystem.saveShareCode(code, descInput.value);
        
        if (success) {
            this.showToast('分享码已生成', 'success');
            codeInput.value = '';
            descInput.value = '';
            this.loadShareCodeList(document.getElementById('share-code-list'));
        } else {
            this.showAlertDialog({
                title: '生成失败',
                message: '无法保存分享码',
                type: 'error'
            });
        }
    },

    async loadShareCodeList(container) {
        if (!container) return;
        
        const codes = await this.shareCodeSystem.loadShareCodes();
        container.innerHTML = '';
        
        Object.entries(codes).forEach(([code, info]) => {
            const item = document.createElement('div');
            item.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg';
            item.innerHTML = `
                <div class="flex items-center gap-3">
                    <span class="font-mono font-bold text-amber-600">${code}</span>
                    ${info.description ? `<span class="text-xs text-gray-500">${info.description}</span>` : ''}
                </div>
                <div class="flex gap-2">
                    <button onclick="app.copyShareCode('${code}')" class="text-gray-500 hover:text-indigo-600 p-1" title="复制">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                    <button onclick="app.deleteShareCode('${code}')" class="text-gray-500 hover:text-red-600 p-1" title="删除">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            container.appendChild(item);
        });
        
        if (Object.keys(codes).length === 0) {
            container.innerHTML = '<p class="text-center text-gray-400 text-sm py-4">暂无分享码</p>';
        }
    },

    async deleteShareCode(code) {
        const confirmed = await this.showConfirmDialog({
            title: '删除确认',
            message: `确定删除分享码 ${code}？`,
            confirmText: '删除',
            cancelText: '取消',
            type: 'danger'
        });
        
        if (confirmed) {
            await this.shareCodeSystem.deleteCode(code);
            this.loadShareCodeList(document.getElementById('share-code-list'));
        }
    },

    copyShareCode(code) {
        navigator.clipboard.writeText(code).then(() => {
            this.showToast('已复制到剪贴板', 'success');
        });
    },
    // 【新增】修复图片引用并重新上传丢失的图片
    async fixAndReloadImages() {
        const progress = this.showProgressDialog('修复图片引用...');
        let fixedCount = 0;
        let missingCount = 0;
        
        try {
            // 获取 GitHub 上实际存在的图片列表
            progress.update(10, '获取远程图片列表...');
            const remoteImages = await this.githubStorage.getImageList();
            const remoteSet = new Set(remoteImages);
            
            progress.update(30, '检查条目图片引用...');
            
            for (const entry of this.data.entries) {
                if (!entry.versions) continue;
                
                for (const version of entry.versions) {
                    if (!version.images) continue;
                    
                    for (const [key, value] of Object.entries(version.images)) {
                        if (!value || !value.startsWith('{{IMG:')) continue;
                        
                        const filename = value.slice(6, -2);
                        
                        // 检查图片是否存在于 GitHub
                        if (!remoteSet.has(filename)) {
                            console.warn(`[FixImage] 缺失: ${filename}`);
                            missingCount++;
                            // 清空引用（标记为缺失）
                            version.images[key] = null;
                        } else {
                            fixedCount++;
                        }
                    }
                }
            }
            
            progress.update(80, '保存修复后的数据...');
            await this.saveData();
            
            progress.update(100, `完成！修复 ${fixedCount} 张，缺失 ${missingCount} 张`);
            setTimeout(() => progress.close(), 1000);
            
            if (missingCount > 0) {
                this.showAlertDialog({
                    title: '图片修复报告',
                    message: `${missingCount} 张图片在仓库中不存在，已清除引用。\n请重新导入包含图片的ZIP文件。`,
                    type: 'warning'
                });
            }
            
        } catch (e) {
            progress.close();
            console.error('[FixImage] 失败:', e);
        }
    },

// 【新增】在设置页面添加"修复图片"按钮的调用
// 在 renderSettings 中添加一个按钮调用此方法

    // ========== 数据导出 ==========
    exportData() {
        const dataStr = JSON.stringify(this.data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wiki-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('数据已导出', 'success');
    },

    async exportZipBackup() {
        const JSZip = window.JSZip;
        if (!JSZip) {
            this.showToast('ZIP库未加载', 'error');
            return;
        }
        // 【修复】确保导出时包含所有字段，包括 homeContent 和 customFields
        const exportData = {
            // 基础字段
            entries: this.data.entries,
            chapters: this.data.chapters,
            camps: this.data.camps,
            synopsis: this.data.synopsis,
            announcements: this.data.announcements,
            homeContent: this.data.homeContent || [],
            customFields: this.data.customFields || {},
            
            // 设置字段（兼容GitHub版和本地版格式）
            settings: {
                name: this.data.wikiTitle,
                subtitle: this.data.wikiSubtitle,
                welcomeTitle: this.data.welcomeTitle,
                welcomeSubtitle: this.data.welcomeSubtitle,
                customFont: this.data.fontFamily
            },
            wikiTitle: this.data.wikiTitle, // 冗余保留确保兼容
            wikiSubtitle: this.data.wikiSubtitle,
            fontFamily: this.data.fontFamily,
            
            // 元数据
            version: '2.5.0-github',
            exportTime: Date.now()
        };
        
        const zip = new JSZip();
        zip.file('data.json', JSON.stringify(exportData, null, 2));
        
        const imagesFolder = zip.folder('wiki-images');
        const imageList = await this.githubStorage.getImageList();
        
        for (const filename of imageList) {
            const imgUrl = await this.githubStorage.loadImage(filename);
            if (imgUrl) {
                try {
                    const response = await fetch(imgUrl);
                    const blob = await response.blob();
                    imagesFolder.file(filename, blob);
                } catch (e) {
                    console.warn('无法下载图片:', filename);
                }
            }
        }
        
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wiki-backup-${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('备份已导出', 'success');
    },
    // 【新增】版本内容变更检测（放在 app 对象内任意方法外部）
    hasVersionContentChanged(oldV, newV) {
        if (!oldV || !newV) return true;
        
        // 对比关键字段：标题、题记、等级、正文块、图片引用
        const criticalFields = ['title', 'subtitle', 'level'];
        for (const field of criticalFields) {
            if ((oldV[field] || '') !== (newV[field] || '')) return true;
        }
        
        // 对比图片引用（处理对象和字符串两种情况）
        const oldImages = JSON.stringify(oldV.images || {});
        const newImages = JSON.stringify(newV.images || {});
        if (oldImages !== newImages) return true;
        
        // 对比正文块（数组深比较）
        const oldBlocks = JSON.stringify(oldV.blocks || []);
        const newBlocks = JSON.stringify(newV.blocks || []);
        if (oldBlocks !== newBlocks) return true;
        
        return false;
    },
    // ========== 字体设置 ==========
    changeFont(font) {
        this.data.fontFamily = font;
        this.data.settings = this.data.settings || {};
        this.data.settings.customFont = font;
        
        // 切换字体类而非直接修改CSS变量（避免CORS问题）
        if (font.includes('Serif')) {
            document.body.classList.add('font-serif');
        } else {
            document.body.classList.remove('font-serif');
        }
        
        // 同时更新CSS变量作为后备
        document.documentElement.style.setProperty('--custom-font', font);
    },

    applyFont() {
        const font = this.data.settings?.customFont || this.data.fontFamily || "'Noto Sans SC', sans-serif";
        
        // 应用字体设置
        if (font && font.includes('Serif')) {
            document.body.classList.add('font-serif');
        } else {
            document.body.classList.remove('font-serif');
        }
        
        document.documentElement.style.setProperty('--custom-font', font);
        document.body.style.fontFamily = font;
    },

    // ========== 辅助函数 ==========
    getVisibleVersion(entry) {
        if (!entry || !entry.versions || entry.versions.length === 0) return null;
        
        // 【关键修复】优先返回手动切换的版本（viewingVersionId）
        if (this.data.viewingVersionId) {
            const specificVersion = entry.versions.find(v => v.vid === this.data.viewingVersionId);
            if (specificVersion) return specificVersion;
        }
        
        // 时间线模式逻辑保持不变
        if (this.data.currentTimeline === 'latest') {
            return entry.versions[entry.versions.length - 1];
        }
        
        const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
        if (!currentCh) return entry.versions[entry.versions.length - 1];
        
        return entry.versions.find(v => {
            const fromOrder = this.getChapterOrder(v.chapterFrom);
            const toOrder = this.getChapterOrder(v.chapterTo);
            return currentCh.order >= fromOrder && currentCh.order <= toOrder;
        }) || entry.versions[entry.versions.length - 1];
    },

    getChapterOrder(chapterId) {
        if (!chapterId) return -1;
        const chapter = this.data.chapters.find(c => c.id === chapterId);
        return chapter ? chapter.order : -1;
    },

    formatChapterNum(num) {
        if (num === undefined || num === null) return '';
        if (typeof num === 'string') return num;
        return `第${num}章`;
    },

    generateCode(type) {
        const prefix = type === 'character' ? 'C' : 'S';
        const existing = this.data.entries.filter(e => e.type === type);
        const maxNum = existing.reduce((max, e) => {
            const match = e.code.match(/\d+/);
            return match ? Math.max(max, parseInt(match[0])) : max;
        }, 0);
        return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
    },

    searchAndOpen(name) {
        const entry = this.data.entries.find(e => {
            const v = this.getVisibleVersion(e);
            return v && v.title === name;
        });
        
        if (entry) {
            this.openEntry(entry.id);
        } else {
            this.showToast('未找到该词条', 'warning');
        }
    },

    // ========== 键盘快捷键 ==========
    bindEditKeyboardShortcuts() {
        const handler = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                this.saveEntry();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
            }
        };
        
        document.addEventListener('keydown', handler);
        this._editKeyHandler = handler;
    },

    unbindEditKeyboardShortcuts() {
        if (this._editKeyHandler) {
            document.removeEventListener('keydown', this._editKeyHandler);
            this._editKeyHandler = null;
        }
    },

    undo() {
        this.showToast('撤销功能开发中', 'info');
    },

    // ========== 弹窗系统 ==========
    showConfirmDialog(options) {
        return new Promise((resolve) => {
            const { title = '确认', message, confirmText = '确认', cancelText = '取消', type = 'info' } = options;
            
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
            
            const iconColors = {
                info: 'text-blue-600 bg-blue-100',
                warning: 'text-amber-600 bg-amber-100',
                danger: 'text-red-600 bg-red-100',
                success: 'text-green-600 bg-green-100'
            };
            
            const icons = {
                info: 'fa-circle-info',
                warning: 'fa-triangle-exclamation',
                danger: 'fa-circle-exclamation',
                success: 'fa-check-circle'
            };
            
            overlay.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
                    <div class="text-center mb-6">
                        <div class="w-16 h-16 ${iconColors[type]} rounded-full flex items-center justify-center mx-auto mb-4">
                            <i class="fa-solid ${icons[type]} text-2xl"></i>
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>
                        <p class="text-gray-600 text-sm whitespace-pre-wrap">${message}</p>
                    </div>
                    <div class="flex gap-3">
                        <button id="confirm-cancel" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">
                            ${cancelText}
                        </button>
                        <button id="confirm-ok" class="flex-1 py-2.5 ${type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white rounded-lg transition font-medium shadow-lg">
                            ${confirmText}
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            overlay.querySelector('#confirm-cancel').onclick = () => {
                overlay.remove();
                resolve(false);
            };
            
            overlay.querySelector('#confirm-ok').onclick = () => {
                overlay.remove();
                resolve(true);
            };
            
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(false);
                }
            };
        });
    },

    showAlertDialog(options) {
        return new Promise((resolve) => {
            const { title = '提示', message, confirmText = '确定', type = 'info' } = options;
            
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
            
            const iconColors = {
                info: 'text-blue-600 bg-blue-100',
                warning: 'text-amber-600 bg-amber-100',
                danger: 'text-red-600 bg-red-100',
                success: 'text-green-600 bg-green-100'
            };
            
            const icons = {
                info: 'fa-circle-info',
                warning: 'fa-triangle-exclamation',
                danger: 'fa-circle-exclamation',
                success: 'fa-check-circle'
            };
            
            overlay.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
                    <div class="text-center mb-6">
                        <div class="w-16 h-16 ${iconColors[type]} rounded-full flex items-center justify-center mx-auto mb-4">
                            <i class="fa-solid ${icons[type]} text-2xl"></i>
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>
                        <p class="text-gray-600 text-sm whitespace-pre-wrap">${message}</p>
                    </div>
                    <button id="alert-ok" class="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium shadow-lg">
                        ${confirmText}
                    </button>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            overlay.querySelector('#alert-ok').onclick = () => {
                overlay.remove();
                resolve(true);
            };
            
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(true);
                }
            };
        });
    },

    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `fixed top-20 left-1/2 transform -translate-x-1/2 z-[99999] px-4 py-2 rounded-lg shadow-lg text-white text-sm flex items-center gap-2 fade-in`;
        
        const colors = {
            info: 'bg-blue-600',
            success: 'bg-green-600',
            warning: 'bg-amber-600',
            error: 'bg-red-600'
        };
        
        toast.classList.add(colors[type] || colors.info);
        
        const icons = {
            info: 'fa-circle-info',
            success: 'fa-check-circle',
            warning: 'fa-triangle-exclamation',
            error: 'fa-circle-exclamation'
        };
        
        toast.innerHTML = `
            <i class="fa-solid ${icons[type]}"></i>
            <span>${message}</span>
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    // ========== 搜索功能 ==========
    handleSearchInput(value) {
        const dropdown = document.getElementById('search-dropdown');
        if (!value.trim()) {
            dropdown.classList.add('hidden');
            return;
        }
        
        const results = this.data.entries.filter(e => {
            const v = this.getVisibleVersion(e);
            return v && (e.code.toLowerCase().includes(value.toLowerCase()) || 
                        v.title.toLowerCase().includes(value.toLowerCase()));
        }).slice(0, 8);
        
        if (results.length === 0) {
            dropdown.innerHTML = '<div class="p-3 text-center text-gray-400 text-sm">无结果</div>';
        } else {
            dropdown.innerHTML = results.map(e => {
                const v = this.getVisibleVersion(e);
                return `
                    <div class="p-3 hover:bg-gray-50 cursor-pointer flex items-center gap-3" onclick="app.openEntry('${e.id}'); app.hideSearchDropdown();">
                        <span class="font-mono text-xs text-gray-400">${e.code}</span>
                        <span class="text-sm text-gray-700">${v.title}</span>
                    </div>
                `;
            }).join('');
        }
        
        dropdown.classList.remove('hidden');
    },

    showSearchDropdown() {
        const dropdown = document.getElementById('search-dropdown');
        const input = document.getElementById('global-search');
        if (input && input.value.trim()) {
            dropdown.classList.remove('hidden');
        }
    },

    hideSearchDropdown() {
        setTimeout(() => {
            const dropdown = document.getElementById('search-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
        }, 200);
    },

    // ========== 首页自定义内容 ==========
    addHomeTextBox() {
        if (!this.data.homeContent) this.data.homeContent = [];
        this.data.homeContent.push({ type: 'text', content: '' });
        this.renderHomeCustomContent();
    },

    addHomeEntryRef() {
        this.showEntrySelectDialog((entry) => {
            if (!entry) return;
            
            // 【同步】如果存在多个版本，显示版本选择弹窗（GitHub精简版，无时间段）
            if (entry.versions && entry.versions.length > 1) {
                this.showVersionSelectDialogForHome(entry, (version, badgeInfo) => {
                    if (!version) return; // 用户取消
                    
                    this.addHomeEntryRefInternal(entry.id, version.vid, version.title, badgeInfo);
                });
            } else {
                // 单版本词条，直接添加
                const version = entry.versions[0];
                this.addHomeEntryRefInternal(entry.id, version?.vid, version?.title || entry.code, null);
            }
        });
    },
    // 【新增】首页引用内部添加方法，支持版本ID和徽章样式
    addHomeEntryRefInternal(entryId, versionId, title, badgeInfo) {
        if (!this.data.homeContent) this.data.homeContent = [];
        this.data.homeContent.push({ 
            type: 'entry-ref', 
            entryId: entryId, 
            versionId: versionId,  // 【关键】存储版本ID实现定向引用
            title: title,
            // 支持自定义徽章（蓝底白字、黄底白字、灰底白字）
            badgeText: badgeInfo?.text || '',
            badgeClass: badgeInfo?.class || '' // 如 'bg-yellow-500 text-white', 'bg-blue-500 text-white', 'bg-gray-500 text-white'
        });
        this.renderHomeCustomContent();
        this.showToast('已添加引用', 'success');
    },

    // 【新增】GitHub精简版版本选择弹窗（无时间段显示，支持徽章选择）
    showVersionSelectDialogForHome(entry, callback) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
                <div class="p-4 border-b bg-indigo-50 rounded-t-xl flex justify-between items-center">
                    <div>
                        <h3 class="font-bold text-lg text-indigo-800">选择要引用的版本</h3>
                        <p class="text-xs text-gray-600 mt-1">${entry.code} · ${entry.versions.length}个版本</p>
                    </div>
                    <button id="close-version-modal" class="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-full hover:bg-indigo-100 transition">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="p-4 overflow-y-auto">
                    <div id="version-list-container" class="space-y-2">
                    </div>
                    
                    <!-- 徽章样式选择 -->
                    <div class="mt-4 pt-4 border-t border-gray-200">
                        <p class="text-xs text-gray-500 mb-2">选择右侧标签样式（可选）：</p>
                        <div class="flex gap-2">
                            <button onclick="app._selectBadgeStyle(null)" class="badge-select-btn flex-1 py-2 text-xs rounded border border-gray-200 hover:bg-gray-50 transition" data-style="">无标签</button>
                            <button onclick="app._selectBadgeStyle('bg-yellow-500 text-white')" class="badge-select-btn flex-1 py-2 text-xs rounded border border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 transition" data-style="bg-yellow-500 text-white">黄底白字</button>
                            <button onclick="app._selectBadgeStyle('bg-blue-500 text-white')" class="badge-select-btn flex-1 py-2 text-xs rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition" data-style="bg-blue-500 text-white">蓝底白字</button>
                            <button onclick="app._selectBadgeStyle('bg-gray-500 text-white')" class="badge-select-btn flex-1 py-2 text-xs rounded border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 transition" data-style="bg-gray-500 text-white">灰底白字</button>
                        </div>
                        <input type="text" id="badge-custom-text" placeholder="输入自定义文字（如'主角'、'重要'）" class="w-full mt-2 p-2 border border-gray-200 rounded text-xs">
                    </div>
                </div>
                <div class="p-4 border-t bg-gray-50 rounded-b-xl flex justify-between items-center">
                    <span class="text-xs text-gray-500">选择后将引用该版本的大标题</span>
                    <div class="flex gap-2">
                        <button id="btn-confirm-select" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium">
                            确认添加
                        </button>
                        <button id="btn-cancel-select" class="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition text-sm">
                            取消
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        let selectedVersion = null;
        let selectedBadgeStyle = null;
        
        // 临时方法供按钮调用
        this._selectBadgeStyle = (style) => {
            selectedBadgeStyle = style;
            // 视觉反馈
            overlay.querySelectorAll('.badge-select-btn').forEach(btn => {
                if (btn.dataset.style === style) {
                    btn.classList.add('ring-2', 'ring-indigo-500', 'bg-opacity-100');
                    if(style) btn.classList.add('text-white');
                } else {
                    btn.classList.remove('ring-2', 'ring-indigo-500', 'bg-opacity-100', 'text-white');
                }
            });
        };
        
        const closeModal = (confirmed = false) => {
            if (confirmed && selectedVersion) {
                const badgeText = document.getElementById('badge-custom-text')?.value?.trim() || '';
                const badgeInfo = selectedBadgeStyle ? {
                    text: badgeText,
                    class: selectedBadgeStyle
                } : null;
                callback(selectedVersion, badgeInfo);
            } else {
                callback(null);
            }
            delete this._selectBadgeStyle;
            overlay.remove();
        };
        
        overlay.querySelector('#close-version-modal').onclick = () => closeModal(false);
        overlay.querySelector('#btn-cancel-select').onclick = () => closeModal(false);
        overlay.querySelector('#btn-confirm-select').onclick = () => {
            if (!selectedVersion) {
                this.showToast('请先选择一个版本', 'warning');
                return;
            }
            closeModal(true);
        };
        overlay.onclick = (e) => { if(e.target === overlay) closeModal(false); };
        
        // 渲染版本列表（GitHub精简版：只显示名称，无时间段）
        const container = overlay.querySelector('#version-list-container');
        entry.versions.forEach((version, idx) => {
            const item = document.createElement('div');
            item.className = 'p-3 border border-gray-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer transition flex items-center justify-between';
            item.dataset.vid = version.vid;
            
            const levelBadge = version.level <= 2 ? 
                `<span class="text-[10px] px-2 py-0.5 rounded ${version.level === 1 ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}">${version.level === 1 ? '★ 主角' : '重要'}</span>` : '';
            
            item.innerHTML = `
                <div>
                    <div class="font-bold text-gray-800">${version.title}</div>
                    <div class="text-xs text-gray-400 mt-0.5">版本 ${idx + 1}</div>
                </div>
                <div class="flex items-center gap-2">
                    ${levelBadge}
                    <i class="fa-solid fa-chevron-right text-gray-300"></i>
                </div>
            `;
            
            item.onclick = () => {
                selectedVersion = version;
                // 视觉反馈：选中高亮
                container.querySelectorAll('div[data-vid]').forEach(div => {
                    div.classList.remove('border-indigo-500', 'bg-indigo-50');
                });
                item.classList.add('border-indigo-500', 'bg-indigo-50');
                
                // 自动建议标签（根据重要程度）
                const badgeInput = document.getElementById('badge-custom-text');
                if (version.level === 1 && !selectedBadgeStyle) {
                    this._selectBadgeStyle('bg-yellow-500 text-white');
                    if(badgeInput) badgeInput.value = '主角';
                } else if (version.level === 2 && !selectedBadgeStyle) {
                    this._selectBadgeStyle('bg-blue-500 text-white');
                    if(badgeInput) badgeInput.value = '重要';
                }
            };
            
            container.appendChild(item);
        });
    },

    // 【新增】定向跳转到指定版本（首页引用使用）
    openEntryWithVersion(entryId, versionId) {
        this.data.editingId = entryId;
        this.data.viewingVersionId = versionId;
        this.router('detail');
    },

    showEntrySelectDialog(callback) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
                <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold text-lg text-gray-800">选择词条</h3>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="p-4">
                    <input type="text" id="entry-search-input" placeholder="搜索词条名称或编号..." 
                        class="w-full p-2 border border-gray-200 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-indigo-500 outline-none">
                    <div id="entry-select-list" class="space-y-1 max-h-[50vh] overflow-y-auto"></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        const list = overlay.querySelector('#entry-select-list');
        const searchInput = overlay.querySelector('#entry-search-input');
        
        const renderEntries = (filter = '') => {
            list.innerHTML = '';
            this.data.entries.forEach(entry => {
                const visibleVersion = this.getVisibleVersion(entry);
                const title = visibleVersion ? visibleVersion.title : entry.code;
                if (filter && !entry.code.toLowerCase().includes(filter.toLowerCase()) && !title.toLowerCase().includes(filter.toLowerCase())) return;
                
                const item = document.createElement('div');
                item.className = 'p-3 hover:bg-indigo-50 cursor-pointer rounded-lg border-b border-gray-100 flex items-center gap-3 transition';
                item.innerHTML = `
                    <span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold">${entry.code}</span>
                    <span class="text-sm text-gray-700">${title}</span>
                `;
                item.onclick = () => { overlay.remove(); callback(entry); };
                list.appendChild(item);
            });
        };
        
        renderEntries();
        searchInput.oninput = (e) => renderEntries(e.target.value);
        searchInput.focus();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    updateHomeText(idx, value) {
        if (this.data.homeContent && this.data.homeContent[idx]) {
            this.data.homeContent[idx].content = value;
        }
    },

    removeHomeItem(idx) {
        if (this.data.homeContent) {
            this.data.homeContent.splice(idx, 1);
            this.renderHomeCustomContent();
        }
    },

    saveHomeContent() {
        this.saveData();
        this.showToast('首页内容已保存，请进入控制台确认进度并验证是否成功', 'success');
    },
    // 【新增】设置页面专用的保存方法
    async saveSettingsData() {
        const btn = document.querySelector('#settings-save-status');
        if (btn) {
            btn.style.opacity = '0';
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>保存中...';
            btn.style.opacity = '1';
        }

        try {
            // 确保当前数据是最新的（包括字体设置等）
            const fontSelect = document.getElementById('setting-font');
            if (fontSelect) {
                this.data.settings.customFont = fontSelect.value;
                this.data.fontFamily = fontSelect.value;
            }

            // 使用原子保存确保数据完整性
            await this.saveDataAtomic();
            
            // 显示成功状态
            if (btn) {
                btn.innerHTML = '<i class="fa-solid fa-check-circle mr-1"></i>保存成功！';
                setTimeout(() => {
                    btn.style.opacity = '0';
                }, 3000);
            }
            
            this.showToast('设置已保存到 GitHub', 'success');
            
        } catch (error) {
            console.error('保存失败:', error);
            if (btn) {
                btn.innerHTML = '<i class="fa-solid fa-exclamation-circle mr-1"></i>保存失败，请重试';
                btn.classList.add('text-red-200');
            }
            this.showToast('保存失败: ' + error.message, 'error');
        }
    },
    // ========== 版本管理器（占位）==========
    showVersionManager() {
        this.showToast('版本管理器功能开发中', 'info');
    },

    // 【新增】进度条弹窗系统
    // 替换 showProgressDialog 方法（添加 show 方法）

    showProgressDialog: function(title = '处理中') {
        const overlay = document.createElement('div');
        overlay.id = 'global-progress-overlay';
        overlay.className = 'fixed inset-0 bg-black/60 z-[100000] flex items-center justify-center p-4';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                <h3 id="progress-title" class="text-lg font-bold text-gray-800 mb-4">${title}</h3>
                <div class="w-full bg-gray-200 rounded-full h-3 mb-3 overflow-hidden">
                    <div id="progress-bar" class="bg-indigo-600 h-3 rounded-full transition-all duration-300 ease-out" style="width: 0%"></div>
                </div>
                <div class="flex justify-between items-center">
                    <span id="progress-text" class="text-sm text-gray-600">准备中...</span>
                    <span id="progress-percent" class="text-sm font-bold text-indigo-600">0%</span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        return {
            update: (percent, text) => {
                const bar = document.getElementById('progress-bar');
                const percentText = document.getElementById('progress-percent');
                const descText = document.getElementById('progress-text');
                if (bar) bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
                if (percentText) percentText.textContent = Math.round(percent) + '%';
                if (descText && text) descText.textContent = text;
            },
            close: () => {
                const el = document.getElementById('global-progress-overlay');
                if (el) {
                    el.style.opacity = '0';
                    el.style.transition = 'opacity 0.3s';
                    setTimeout(() => el.remove(), 300);
                }
            },
            // 【新增】show 方法，用于重新显示（如果之前只是隐藏）
            show: () => {
                const el = document.getElementById('global-progress-overlay');
                if (el) {
                    el.style.display = 'flex';
                    el.style.opacity = '1';
                }
            },
            // 【新增】hide 方法，用于临时隐藏（不删除元素）
            hide: () => {
                const el = document.getElementById('global-progress-overlay');
                if (el) {
                    el.style.opacity = '0';
                    setTimeout(() => { if(el.style.opacity === '0') el.style.display = 'none'; }, 300);
                }
            }
        };
    },
    async saveData(progressCallback = null) {
        // 估算数据大小
        const dataSize = JSON.stringify(this.data).length;
        const entryCount = this.data.entries?.length || 0;
        
        console.log(`[Wiki] 保存数据: ${entryCount} 条目, 约 ${(dataSize/1024).toFixed(2)} KB`);
        
        // 如果数据量小（<100KB或条目<30），使用原子保存
        if (dataSize < 100 * 1024 || entryCount < 30) {
            console.log('[Wiki] 数据量较小，使用原子保存');
            if (progressCallback) {
                progressCallback(50, '保存中...');
            }
            await this.saveDataAtomic();
            if (progressCallback) {
                progressCallback(100, '完成');
            }
        } else {
            // 大数据量使用分片保存
            console.log('[Wiki] 数据量较大，使用分片保存');
            await this.saveDataSharded(progressCallback);
        }
    },
    // 【完整替换】saveDataSharded 方法 - 针对 data.json 强化保存
    async saveDataSharded(progressCallback = null) {
        try {
            console.log('[Wiki] 开始分片保存数据...');
            
            // 确保基础数据结构
            if (!this.data.entries) this.data.entries = [];
            if (!this.data.settings) this.data.settings = {};
            
            const totalEntries = this.data.entries.length;
            console.log(`[Wiki] 需要保存 ${totalEntries} 个词条`);
            
            // 分片配置：每 20 个词条一个文件
            const ENTRIES_PER_FILE = 20;
            const totalShards = Math.ceil(totalEntries / ENTRIES_PER_FILE);
            
            if (progressCallback) progressCallback(5, '正在准备数据...');
            
            // 1. 构建基础数据
            const baseData = {
                version: '2.7.0-sharded',
                lastUpdate: Date.now(),
                totalEntries: totalEntries,
                entryFiles: [],
                settings: this.data.settings,
                chapters: this.data.chapters || [],
                camps: this.data.camps || ['主角团', '反派', '中立'],
                synopsis: this.data.synopsis || [],
                announcements: this.data.announcements || [],
                homeContent: this.data.homeContent || [],
                customFields: this.data.customFields || {},
                // 时间节点数据
                timelineNodes: this.data.timelineNodes || [],
                newReaderNodeId: this.data.newReaderNodeId,
                latestNodeId: this.data.latestNodeId
            };
            
            // 2. 清理并准备分片数据
            const cleanedEntries = JSON.parse(JSON.stringify(this.data.entries));
            cleanedEntries.forEach(entry => {
                if (entry.versions) {
                    entry.versions.forEach(v => {
                        // 移除内嵌 base64，保留引用
                        if (v.image && v.image.startsWith('data:')) v.image = null;
                        if (v.images) {
                            Object.keys(v.images).forEach(k => {
                                if (v.images[k] && v.images[k].startsWith('data:')) {
                                    v.images[k] = null;
                                }
                            });
                        }
                    });
                }
            });
            
            // 3. 分片保存 entries
            const entryShards = [];
            for (let i = 0; i < totalEntries; i += ENTRIES_PER_FILE) {
                const shard = cleanedEntries.slice(i, i + ENTRIES_PER_FILE);
                const shardIndex = Math.floor(i / ENTRIES_PER_FILE);
                const fileName = `entries-${shardIndex}.json`;
                entryShards.push({ 
                    name: fileName, 
                    data: shard, 
                    start: i, 
                    end: Math.min(i + ENTRIES_PER_FILE, totalEntries),
                    size: JSON.stringify(shard).length 
                });
                baseData.entryFiles.push(fileName);
            }
            
            console.log(`[Wiki] 分为 ${entryShards.length} 个分片`);
            
            // 4. 【关键修复】先保存基础数据（使用15次重试和初始延迟）
            if (progressCallback) progressCallback(10, '保存基础索引...');
            
            let baseSaved = false;
            for (let retry = 0; retry < 3; retry++) {
                try {
                    // 首次尝试前等待，避免与前次操作冲突
                    if (retry === 0) await new Promise(r => setTimeout(r, 1500));
                    
                    // 【关键】使用15次重试（而非默认10次）
                    await this.githubStorage.putFile(
                        'data.json', 
                        JSON.stringify(baseData, null, 2), 
                        'Update Wiki base data',
                        false,
                        15 // 强制15次重试
                    );
                    baseSaved = true;
                    console.log('[Wiki] ✅ 基础数据已保存');
                    break;
                } catch (e) {
                    console.warn(`[Wiki] 基础数据保存尝试 ${retry + 1} 失败:`, e.message);
                    if (retry === 2) {
                        throw new Error('基础数据保存失败: ' + e.message);
                    }
                    await new Promise(r => setTimeout(r, 3000 * (retry + 1))); // 递增延迟
                }
            }
            
            if (progressCallback) progressCallback(20, `开始保存 ${entryShards.length} 个分片...`);
            
            // 5. 逐个保存分片（带批次间延迟）
            let savedShards = 0;
            let failedShards = [];
            
            for (let i = 0; i < entryShards.length; i++) {
                const shard = entryShards[i];
                let shardSaved = false;
                
                // 【关键】批次间添加基础延迟，避免GitHub API限流
                if (i > 0) {
                    const batchDelay = 800; // 800ms间隔
                    await new Promise(r => setTimeout(r, batchDelay));
                }
                
                // 每个分片独立重试3次
                for (let retry = 0; retry < 3; retry++) {
                    try {
                        console.log(`[Wiki] 保存分片 ${shard.name} (${shard.start}-${shard.end})...`);
                        
                        await this.githubStorage.putFile(
                            shard.name, 
                            JSON.stringify(shard.data, null, 2), 
                            `Update entries ${shard.start}-${shard.end}`
                        );
                        
                        savedShards++;
                        shardSaved = true;
                        break;
                        
                    } catch (e) {
                        console.warn(`[Wiki] ⚠️ 分片 ${shard.name} 尝试 ${retry + 1}/3 失败:`, e.message);
                        
                        if (retry < 2) {
                            await new Promise(r => setTimeout(r, 2000 * (retry + 1)));
                        }
                    }
                }
                
                if (!shardSaved) {
                    failedShards.push(shard.name);
                    console.error(`[Wiki] ❌ 分片 ${shard.name} 最终失败`);
                }
                
                // 更新进度：20% ~ 90%
                const progress = 20 + (70 * (i + 1) / entryShards.length);
                if (progressCallback) progressCallback(progress, `正在保存词条 ${shard.end}/${totalEntries}...`);
            }
            
            // 6. 【关键修复】最终索引保存前添加延迟，确保GitHub缓存已更新
            if (progressCallback) progressCallback(95, '正在最终确认...');
            
            await new Promise(r => setTimeout(r, 3000)); // 3秒延迟
            
            // 更新失败标记（如果有）
            if (failedShards.length > 0) {
                baseData.failedShards = failedShards;
                baseData.lastUpdate = Date.now();
            }
            
            // 使用15次重试保存最终索引
            let finalSaved = false;
            for (let retry = 0; retry < 3; retry++) {
                try {
                    await this.githubStorage.putFile(
                        'data.json', 
                        JSON.stringify(baseData, null, 2), 
                        'Import complete',
                        false,
                        15
                    );
                    finalSaved = true;
                    break;
                } catch (e) {
                    console.warn(`[Wiki] 最终索引保存尝试 ${retry + 1} 失败:`, e.message);
                    if (retry === 2) {
                        console.warn('[Wiki] ⚠️ 最终索引保存失败，但分片数据已保存');
                        // 不抛出错误，因为这是非致命的，数据已经保存
                        break;
                    }
                    await new Promise(r => setTimeout(r, 5000 * (retry + 1))); // 更长延迟
                }
            }
            
            if (progressCallback) progressCallback(100, '保存完成！');
            
            const successMsg = failedShards.length > 0 
                ? `已保存，但 ${failedShards.length} 个分片失败` 
                : '所有数据已保存到GitHub';
            console.log(`[Wiki] ✅ ${successMsg}`);
            
            return {
                success: true,
                totalShards: entryShards.length,
                savedShards: savedShards,
                failedShards: failedShards
            };
            
        } catch (error) {
            console.error('[Wiki] ❌ 保存失败:', error);
            throw error;
        }
    },

    // 【新增】分片加载方法（需要在 loadDataFromGitHub 中使用）
    async loadShardedData(baseData) {
        console.log('[Wiki] 检测到分片数据，开始加载...');
        const entries = [];
        let loadedShards = 0;
        let failedShards = 0;
        
        // 并行加载所有分片（提高速度）
        const shardPromises = (baseData.entryFiles || []).map(async (fileName) => {
            try {
                const file = await this.githubStorage.getFile(fileName);
                if (file && file.content) {
                    const shardData = JSON.parse(file.content);
                    if (Array.isArray(shardData)) {
                        entries.push(...shardData);
                        loadedShards++;
                        console.log(`[Wiki] ✅ 加载分片 ${fileName} (${shardData.length} 条)`);
                        return;
                    }
                }
                throw new Error('分片内容无效');
            } catch (e) {
                console.error(`[Wiki] ❌ 加载分片 ${fileName} 失败:`, e.message);
                failedShards++;
            }
        });
        
        await Promise.all(shardPromises);
        
        console.log(`[Wiki] 分片加载完成: ${loadedShards} 成功, ${failedShards} 失败, 共 ${entries.length} 条`);
        return entries;
    },

    // ========== 模式切换 ==========
    setMode(mode) {
        this.data.currentMode = mode;
        const viewBtn = document.getElementById('btn-mode-view');
        const editBtn = document.getElementById('btn-mode-edit');
        
        if (viewBtn) {
            viewBtn.className = mode === 'view' 
                ? 'px-3 py-1.5 rounded-md bg-white shadow-sm text-gray-800 transition-all'
                : 'px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800 transition-all';
        }
        if (editBtn) {
            editBtn.className = mode === 'edit'
                ? 'px-3 py-1.5 rounded-md bg-white shadow-sm text-gray-800 transition-all'
                : 'px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800 transition-all';
        }
    }
});
app.handleSynopsisRefHover = function(element) {
    const entryCode = element.dataset.entryCode;
    const chapterId = element.dataset.chapterId;
    
    if (entryCode) {
        const entry = this.data.entries.find(e => e.code === entryCode);
        if (entry) {
            // 简单的 tooltip 实现，可替换为更复杂的预览弹窗
            element.title = `点击查看角色：${entry.versions?.[0]?.title || entryCode}`;
        }
    } else if (chapterId) {
        const chapter = this.data.synopsis.find(s => s.id === chapterId);
        if (chapter) {
            element.title = `点击查看剧情：${chapter.title}`;
        }
    }
};

/**
 * 悬停离开（清理逻辑）
 */
app.handleSynopsisRefLeave = function(element) {
    // 如有复杂的 tooltip DOM 操作，在此处移除
    element.title = '';
};

/**
 * 剧情引用点击事件
 */
app.handleSynopsisRefClick = function(element) {
    const chapterId = element.dataset.chapterId;
    if (!chapterId) return;
    
    const chapter = this.data.synopsis.find(s => s.id === chapterId);
    if (chapter) {
        // 跳转到剧情梗概视图并定位到对应章节
        this.data.synopsisViewIndex = this.data.synopsis.findIndex(s => s.id === chapterId);
        this.router('synopsis');
    }
};

/**
 * 通过编号打开条目（已存在则跳过，确保参数清洗）
 */
app.openEntryByCode = function(code) {
    // 清除可能的转义字符（与本地版兼容）
    const cleanCode = code.replace(/\\/g, '');
    const entry = this.data.entries.find(e => e.code === cleanCode);
    if (entry) {
        this.openEntry(entry.id);
    } else {
        this.showToast('未找到该角色: ' + cleanCode, 'warning');
    }
};

console.log('GitHub Wiki Core v2.0 加载完成');
