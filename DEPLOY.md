# 小说Wiki GitHub版 部署指南

## 目录
1. [快速开始](#快速开始)
2. [GitHub仓库设置](#github仓库设置)
3. [Personal Access Token创建](#personal-access-token创建)
4. [部署步骤](#部署步骤)
5. [前后台模式说明](#前后台模式说明)
6. [存档分享码使用](#存档分享码使用)
7. [常见问题](#常见问题)
8. [故障排除](#故障排除)

---

## 快速开始

### 你需要准备：
- 一个GitHub账号
- 约10分钟时间
- Wiki数据文件（可选，可以从本地版导出）

---

## GitHub仓库设置

### 步骤1：创建新仓库
1. 登录GitHub，点击右上角 `+` → `New repository`
2. 填写仓库信息：
   - **Repository name**: `my-novel-wiki`（可以自定义）
   - **Description**: 可选，例如"我的小说Wiki系统"
   - **Public** 或 **Private** 都可以
   - 勾选 **Add a README file**
3. 点击 **Create repository**

### 步骤2：创建数据目录
1. 进入新创建的仓库
2. 点击 `Add file` → `Create new file`
3. 文件名输入：`wiki-data/data.json`
4. 内容输入（初始空数据）：
   ```json
   {
     "entries": [],
     "chapters": [],
     "camps": ["主角团", "反派", "中立"],
     "synopsis": [],
     "wikiTitle": "我的小说Wiki",
     "wikiSubtitle": "",
     "fontFamily": "'Noto Sans SC', sans-serif"
   }
   ```
5. 点击页面底部的 **Commit new file**

6. 再次点击 `Add file` → `Create new file`
7. 文件名输入：`wiki-data/share-codes.json`
8. 内容输入：
   ```json
   {}
   ```
9. 点击 **Commit new file**

---

## Personal Access Token创建

### 步骤1：生成Token
1. 点击右上角头像 → `Settings`
2. 左侧菜单最下方点击 `Developer settings`
3. 点击 `Personal access tokens` → `Tokens (classic)`
4. 点击 `Generate new token (classic)`
5. 填写信息：
   - **Note**: `Wiki Access Token`
   - **Expiration**: 选择过期时间（建议选择 `No expiration` 永久有效）
   - **Scopes**: 勾选以下权限：
     - ✅ `repo`（完整仓库访问权限）
6. 点击页面底部的 **Generate token**

### 步骤2：保存Token
⚠️ **重要**：Token只会显示一次！
- 复制生成的Token（格式如 `ghp_xxxxxxxxxxxxxxxxxxxx`）
- 保存到安全的地方（密码管理器或本地文件）

---

## 部署步骤

### 步骤1：上传Wiki文件
1. 在仓库页面，点击 `Add file` → `Upload files`
2. 上传以下文件（从 `wiki-github` 文件夹）：
   - `index.html`
   - `wiki-github-core.js`
   - `wiki-github-storage.js`
3. 点击 **Commit changes**

### 步骤2：启用GitHub Pages
1. 进入仓库的 `Settings` 标签
2. 左侧菜单点击 `Pages`
3. **Source** 部分选择：
   - Branch: `main`
   - Folder: `/ (root)`
4. 点击 **Save**
5. 等待约1-5分钟
6. 页面会显示访问地址，格式为：`https://你的用户名.github.io/仓库名/`

### 步骤3：首次访问配置
1. 打开GitHub Pages地址
2. 首次访问会显示登录页面
3. 填写以下信息：
   - **GitHub用户名**: 你的GitHub用户名
   - **仓库名称**: 刚才创建的仓库名
   - **分支**: 默认 `main`
   - **Personal Access Token**: 刚才生成的Token
4. 点击 **连接**

---

## 前后台模式说明

### 后台模式（编辑模式）
**使用方式**：直接通过GitHub Token登录

**功能**：
- ✅ 查看所有词条
- ✅ 创建/编辑/删除词条
- ✅ 上传图片
- ✅ 生成存档分享码
- ✅ 导出数据备份

### 前台模式（只读模式）
**使用方式**：点击"仅浏览模式（需要分享码）"

**功能**：
- ✅ 查看所有词条
- ✅ 调整字体设置
- ✅ 导出数据（需要正确分享码）
- ❌ 无法编辑内容

**配置前台模式**：
需要在 `index.html` 中添加前台模式配置（在 `<script>` 标签中）：
```javascript
// 前台模式配置（供读者使用）
localStorage.setItem('wiki_frontend_config', JSON.stringify({
    owner: '你的GitHub用户名',
    repo: '你的仓库名',
    token: 'ghp_xxxxxxxxxxxxxxxxxxxx',  // 只读Token或相同Token
    branch: 'main',
    dataPath: 'wiki-data'
}));
```

---

## 存档分享码使用

### 生成分享码（后台模式）
1. 以后台模式登录
2. 进入 **设置** 页面
3. 在"存档分享码"区域：
   - 输入自定义分享码（8位字母数字，可选）
   - 或留空自动生成
   - 添加描述（可选）
4. 点击 **生成**

### 使用分享码（前台模式）
1. 访问Wiki页面
2. 点击"仅浏览模式（需要分享码）"
3. 输入8位分享码
4. 点击 **验证并进入**

### 分享码管理
- 在后台模式的设置页面可以查看所有分享码
- 可以删除不再使用的分享码
- 可以复制分享码分享给读者

---

## 常见问题

### Q1: 连接失败，提示"Token无效"
**解决方法**：
1. 检查Token是否正确复制（注意没有多余的空格）
2. 确认Token有 `repo` 权限
3. 如果Token已过期，需要重新生成

### Q2: 无法保存数据
**可能原因**：
- 网络连接问题
- Token权限不足
- 仓库不存在或名称错误

**解决方法**：
1. 检查仓库名称和用户名是否正确
2. 确认Token有完整的 `repo` 权限
3. 检查浏览器控制台（F12）查看详细错误信息

### Q3: 图片无法显示
**解决方法**：
1. 确认图片已上传到 `wiki-data/images/` 目录
2. 检查图片文件名是否正确
3. 首次加载可能需要刷新页面

### Q4: 如何备份数据
**方法1（GitHub版）**：
- 进入设置页面
- 点击"导出ZIP"下载完整备份

**方法2（手动）**：
- 直接下载 `wiki-data/data.json` 文件
- 下载 `wiki-data/images/` 目录下的所有图片

### Q5: 如何迁移本地数据到GitHub版

**方法1：使用数据导入功能（推荐）**

1. 在本地版导出ZIP备份
2. 解压ZIP文件，整理为以下结构：
   ```
   Wiki数据/
   ├── data.json          # 主数据文件
   └── wiki-images/       # 图片文件夹
       ├── image1.jpg
       ├── image2.png
       └── ...
   ```
3. 在GitHub版后台模式中，进入 **设置** 页面
4. 找到 **数据导入** 区域
5. 点击 **选择Wiki数据文件夹**，选择包含 `data.json` 和 `wiki-images` 的文件夹
6. 等待导入完成，系统会自动：
   - 合并词条数据（跳过重复的词条）
   - 上传图片到GitHub仓库
   - 保存更新后的数据

**方法2：手动上传（适用于少量数据）**
1. 在本地版导出ZIP备份
2. 解压ZIP文件
3. 将 `data.json` 内容复制到GitHub仓库的 `wiki-data/data.json`
4. 将 `images/` 文件夹中的图片上传到 `wiki-data/images/`

### Q6: 如何添加其他编辑者
**方法1**：分享Token（不推荐，有安全风险）

**方法2**：创建协作Token
1. 让协作者创建自己的GitHub账号
2. 将协作者添加为仓库的 Collaborator
3. 协作者生成自己的Personal Access Token
4. 协作者使用自己的Token登录

---

## 故障排除

### GitHub Pages 无法访问

#### 症状
- 访问 `https://用户名.github.io/仓库名/` 显示 404 错误
- 页面空白或显示 "Site not found"

#### 解决方法

**1. 检查GitHub Pages是否已启用**
1. 进入仓库的 `Settings` → `Pages`
2. 确认 Source 已设置为 `Deploy from a branch`
3. 确认 Branch 已选择 `main` 和 `/(root)`
4. 点击 Save 后等待 2-5 分钟

**2. 检查仓库是否为Public**
- Private 仓库的 GitHub Pages 也有访问限制
- 建议将仓库设置为 Public（Settings → General → Danger Zone → Change repository visibility）

**3. 检查文件是否在正确位置**
- `index.html` 必须在仓库根目录
- 确认文件已正确上传（在仓库主页能看到文件列表）

**4. 使用正确的URL格式**
- 格式：`https://用户名.github.io/仓库名/`
- 注意：区分大小写！
- 示例：`https://zhangsan.github.io/my-novel-wiki/`

**5. 清除浏览器缓存**
- 按 `Ctrl+Shift+R` 强制刷新
- 或尝试无痕模式访问

**6. 检查GitHub Pages构建状态**
1. 进入仓库的 `Actions` 标签
2. 查看是否有 Pages build and deployment 工作流
3. 确认工作流状态为绿色（成功）

**7. 尝试直接访问文件**
- 尝试访问：`https://用户名.github.io/仓库名/index.html`
- 如果这可以访问但根目录不行，可能是默认页面设置问题

**8. 使用自定义域名（可选）**
如果以上方法都无效，可以考虑使用自定义域名：
1. 在仓库根目录创建 `CNAME` 文件
2. 文件内容填写你的域名（如 `wiki.example.com`）
3. 在域名服务商处添加 CNAME 记录指向 `用户名.github.io`

#### 验证GitHub Pages是否正常工作
1. 创建测试文件：在仓库根目录创建 `test.html`
2. 内容：`<h1>Test Page</h1>`
3. 访问：`https://用户名.github.io/仓库名/test.html`
4. 如果能看到 "Test Page"，说明GitHub Pages正常工作

---

## 安全建议

1. **Token安全**：
   - 不要将Token分享给不信任的人
   - 定期更换Token
   - 如果发现Token泄露，立即在GitHub上撤销

2. **仓库隐私**：
   - 如果Wiki内容敏感，建议创建Private仓库
   - Private仓库的GitHub Pages也是公开的，但数据文件受保护

3. **分享码管理**：
   - 定期清理不再使用的分享码
   - 为不同读者生成不同的分享码，便于追踪

---

## 技术支持

如有问题，请检查：
1. 浏览器控制台（F12）的错误信息
2. GitHub API状态：https://www.githubstatus.com/
3. 网络连接是否正常

---

**祝你使用愉快！**
