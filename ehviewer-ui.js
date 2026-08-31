(() => {
    const CONSENT_KEY = 'zgjEhviewerAdultConsent';
    const consent = document.getElementById('ehviewerConsent');
    const enterButton = document.getElementById('ehviewerEnterButton');
    const browser = document.getElementById('ehviewerBrowser');
    const searchForm = document.getElementById('ehviewerSearchForm');
    const searchInput = document.getElementById('ehviewerSearchInput');
    const searchButton = document.getElementById('ehviewerSearchButton');
    const latestButton = document.getElementById('ehviewerLatestButton');
    const status = document.getElementById('ehviewerStatus');
    const galleryGrid = document.getElementById('ehviewerGalleryGrid');
    const loadMoreButton = document.getElementById('ehviewerLoadMoreButton');
    const detail = document.getElementById('ehviewerDetail');
    const backButton = document.getElementById('ehviewerBackButton');
    const detailCover = document.getElementById('ehviewerDetailCover');
    const detailCategory = document.getElementById('ehviewerDetailCategory');
    const detailTitle = document.getElementById('ehviewerDetailTitle');
    const detailJapanese = document.getElementById('ehviewerDetailJapanese');
    const facts = document.getElementById('ehviewerFacts');
    const tagList = document.getElementById('ehviewerTagList');
    const readButton = document.getElementById('ehviewerReadButton');
    const previewMeta = document.getElementById('ehviewerPreviewMeta');
    const previewGrid = document.getElementById('ehviewerPreviewGrid');
    const previewPrev = document.getElementById('ehviewerPreviewPrev');
    const previewNext = document.getElementById('ehviewerPreviewNext');
    const reader = document.getElementById('ehviewerReader');
    const readerTitle = document.getElementById('ehviewerReaderTitle');
    const readerClose = document.getElementById('ehviewerReaderClose');
    const readerStage = document.getElementById('ehviewerReaderStage');
    const readerMessage = document.getElementById('ehviewerReaderMessage');
    const readerImage = document.getElementById('ehviewerReaderImage');
    const readerPrev = document.getElementById('ehviewerReaderPrev');
    const readerNext = document.getElementById('ehviewerReaderNext');
    const readerProgress = document.getElementById('ehviewerReaderProgress');

    let listItems = [];
    let activeSearch = '';
    let nextCursor = null;
    let currentGallery = null;
    let currentBatch = 0;
    let firstPreview = null;
    let readerPage = null;
    let listRequestId = 0;
    let detailRequestId = 0;
    let imageRequestId = 0;

    function setStatus(message = '', isError = false) {
        status.textContent = message;
        status.classList.toggle('is-error', isError);
    }

    function setListBusy(busy) {
        searchButton.disabled = busy;
        latestButton.disabled = busy;
        loadMoreButton.disabled = busy;
        searchButton.textContent = busy ? '读取中…' : '搜索';
    }

    async function api(path) {
        const response = await fetch(path, {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `请求失败（${response.status}）`);
        return data;
    }

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value || '未知';
        return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    function formatFileSize(bytes) {
        const value = Number(bytes) || 0;
        if (value < 1024) return `${value} B`;
        const units = ['KB', 'MB', 'GB', 'TB'];
        let size = value / 1024;
        let unit = units[0];
        for (let index = 1; index < units.length && size >= 1024; index += 1) {
            size /= 1024;
            unit = units[index];
        }
        return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${unit}`;
    }

    function createImage(src, className, alt) {
        const image = document.createElement('img');
        image.className = className;
        image.alt = alt;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        if (src) image.src = src;
        return image;
    }

    function renderList() {
        galleryGrid.replaceChildren();
        if (!listItems.length) {
            const empty = document.createElement('p');
            empty.className = 'ehviewer-empty';
            empty.textContent = activeSearch ? '没有找到匹配的公开画廊，可以换一个关键词试试。' : '当前没有可展示的公开画廊。';
            galleryGrid.appendChild(empty);
            return;
        }

        listItems.forEach((gallery) => {
            const card = document.createElement('button');
            card.className = 'ehviewer-gallery-card';
            card.type = 'button';
            card.setAttribute('aria-label', `查看画廊：${gallery.title}`);

            const coverWrap = document.createElement('div');
            coverWrap.className = 'ehviewer-gallery-cover-wrap';
            coverWrap.appendChild(createImage(gallery.thumbUrl, 'ehviewer-gallery-cover', ''));
            const category = document.createElement('span');
            category.className = 'ehviewer-gallery-category';
            category.textContent = gallery.category || 'Gallery';
            coverWrap.appendChild(category);

            const copy = document.createElement('div');
            copy.className = 'ehviewer-gallery-copy';
            const title = document.createElement('h3');
            title.className = 'ehviewer-gallery-title';
            title.textContent = gallery.title;
            const meta = document.createElement('p');
            meta.className = 'ehviewer-gallery-meta';
            meta.textContent = `${gallery.pages || 0} 页 · ${gallery.uploader || '匿名上传者'}`;
            copy.append(title, meta);
            card.append(coverWrap, copy);
            card.addEventListener('click', () => openGallery(gallery));
            galleryGrid.appendChild(card);
        });
    }

    async function loadList({ append = false } = {}) {
        const requestId = ++listRequestId;
        const params = new URLSearchParams();
        if (activeSearch) params.set('search', activeSearch);
        if (append && nextCursor) params.set('next', nextCursor);
        setListBusy(true);
        setStatus(append ? '正在加载更多公开画廊…' : (activeSearch ? `正在搜索“${activeSearch}”…` : '正在读取最新公开画廊…'));

        try {
            const data = await api(`/api/ehviewer?${params.toString()}`);
            if (requestId !== listRequestId) return;
            const incoming = Array.isArray(data.items) ? data.items : [];
            if (append) {
                const known = new Set(listItems.map((item) => `${item.gid}:${item.token}`));
                listItems.push(...incoming.filter((item) => !known.has(`${item.gid}:${item.token}`)));
            } else {
                listItems = incoming;
            }
            nextCursor = data.nextCursor || null;
            renderList();
            loadMoreButton.hidden = !nextCursor;
            setStatus(activeSearch
                ? `已显示 ${listItems.length} 个与“${activeSearch}”相关的公开画廊`
                : `已显示 ${listItems.length} 个最新公开画廊`);
        } catch (error) {
            if (requestId !== listRequestId) return;
            if (!append) {
                listItems = [];
                renderList();
            }
            setStatus(error.message || '公开画廊暂时不可用', true);
        } finally {
            if (requestId === listRequestId) setListBusy(false);
        }
    }

    function appendFact(label, value) {
        const wrapper = document.createElement('div');
        wrapper.className = 'ehviewer-fact';
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        wrapper.append(term, description);
        facts.appendChild(wrapper);
    }

    function renderPreviews(data) {
        currentBatch = data.batch;
        previewGrid.replaceChildren();
        const previews = Array.isArray(data.previews) ? data.previews : [];
        if (data.batch === 0 && previews[0]) firstPreview = previews[0];

        previews.forEach((preview) => {
            const button = document.createElement('button');
            button.className = 'ehviewer-preview';
            button.type = 'button';
            button.setAttribute('aria-label', `阅读第 ${preview.pageNumber} 页`);
            button.appendChild(createImage(preview.thumbUrl, '', `第 ${preview.pageNumber} 页预览`));
            const number = document.createElement('span');
            number.textContent = String(preview.pageNumber);
            button.appendChild(number);
            button.addEventListener('click', () => openReader(preview));
            previewGrid.appendChild(button);
        });

        const batchCount = Math.max(1, Number(data.batchCount) || 1);
        previewMeta.textContent = `第 ${data.batch + 1} / ${batchCount} 组 · 点击任一缩略图开始阅读`;
        previewPrev.disabled = data.batch <= 0;
        previewNext.disabled = data.batch >= batchCount - 1;
        readButton.disabled = !firstPreview;
    }

    function renderDetail(data) {
        currentGallery = data.gallery;
        const gallery = data.gallery;
        detailCover.src = gallery.thumbUrl || data.previews?.[0]?.thumbUrl || '';
        detailCover.alt = `${gallery.title} 的封面`;
        detailCategory.textContent = gallery.category || 'Gallery';
        detailTitle.textContent = gallery.title;
        detailJapanese.textContent = gallery.japaneseTitle || '';
        detailJapanese.hidden = !gallery.japaneseTitle;
        facts.replaceChildren();
        appendFact('上传者', gallery.uploader || '未知');
        appendFact('图片', `${gallery.fileCount || 0} 页`);
        appendFact('评分', gallery.rating ? `${gallery.rating.toFixed(2)} / 5` : '暂无');
        appendFact('文件大小', formatFileSize(gallery.fileSize));
        appendFact('发布时间', formatDate(gallery.postedAt));

        tagList.replaceChildren();
        (gallery.tags || []).slice(0, 36).forEach((tag) => {
            const item = document.createElement('span');
            item.className = 'ehviewer-tag';
            item.textContent = tag;
            tagList.appendChild(item);
        });
        tagList.hidden = !gallery.tags?.length;
        renderPreviews(data);
    }

    function showDetail(show) {
        detail.hidden = !show;
        galleryGrid.hidden = show;
        loadMoreButton.closest('.ehviewer-list-actions').hidden = show;
        searchForm.hidden = show;
        if (!show) {
            setStatus(activeSearch
                ? `已显示 ${listItems.length} 个与“${activeSearch}”相关的公开画廊`
                : `已显示 ${listItems.length} 个最新公开画廊`);
        }
    }

    async function openGallery(gallery) {
        const requestId = ++detailRequestId;
        firstPreview = null;
        showDetail(true);
        detail.hidden = true;
        setStatus('正在读取画廊资料与图片预览…');
        try {
            const params = new URLSearchParams({ gid: gallery.gid, token: gallery.token, batch: '0' });
            const data = await api(`/api/ehviewer/gallery?${params}`);
            if (requestId !== detailRequestId) return;
            renderDetail(data);
            detail.hidden = false;
            setStatus(`已载入画廊 · 共 ${data.gallery.fileCount || 0} 页`);
            detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            if (requestId !== detailRequestId) return;
            showDetail(false);
            setStatus(error.message || '画廊暂时无法打开', true);
        }
    }

    async function loadPreviewBatch(batch) {
        if (!currentGallery || batch < 0) return;
        previewPrev.disabled = true;
        previewNext.disabled = true;
        setStatus(`正在读取第 ${batch + 1} 组图片预览…`);
        try {
            const params = new URLSearchParams({
                gid: currentGallery.gid,
                token: currentGallery.token,
                batch: String(batch),
                count: String(currentGallery.fileCount || 0)
            });
            const data = await api(`/api/ehviewer/gallery?${params}`);
            renderPreviews(data);
            setStatus(`已载入画廊 · 共 ${currentGallery.fileCount || 0} 页`);
        } catch (error) {
            setStatus(error.message || '图片预览暂时不可用', true);
            previewPrev.disabled = currentBatch <= 0;
            previewNext.disabled = currentBatch >= Math.ceil((currentGallery.fileCount || 1) / 20) - 1;
        }
    }

    function setReaderBusy(message) {
        readerImage.hidden = true;
        readerImage.removeAttribute('src');
        readerMessage.hidden = false;
        readerMessage.textContent = message;
        readerPrev.disabled = true;
        readerNext.disabled = true;
    }

    async function loadReaderPage(target) {
        if (!currentGallery || !target) return;
        const requestId = ++imageRequestId;
        setReaderBusy(`正在读取第 ${target.pageNumber} 页…`);
        readerProgress.textContent = `第 ${target.pageNumber} / ${currentGallery.fileCount || '?'} 页`;
        try {
            const params = new URLSearchParams({ gid: currentGallery.gid, token: target.pageToken, page: String(target.pageNumber) });
            const data = await api(`/api/ehviewer/image?${params}`);
            if (requestId !== imageRequestId) return;
            readerPage = data;
            readerImage.alt = `${currentGallery.title} · 第 ${data.pageNumber} 页`;
            readerImage.onload = () => {
                if (requestId !== imageRequestId) return;
                readerMessage.hidden = true;
                readerImage.hidden = false;
                readerStage.scrollTop = 0;
            };
            readerImage.onerror = () => {
                if (requestId !== imageRequestId) return;
                readerImage.hidden = true;
                readerMessage.hidden = false;
                readerMessage.textContent = '图片加载失败，临时链接可能已过期；请关闭后重新打开这一页。';
            };
            readerImage.src = data.imageUrl;
            readerPrev.disabled = !data.previous;
            readerNext.disabled = !data.next;
            readerProgress.textContent = `第 ${data.pageNumber} / ${currentGallery.fileCount || '?'} 页`;
        } catch (error) {
            if (requestId !== imageRequestId) return;
            readerPage = null;
            readerMessage.textContent = error.message || '图片暂时无法读取';
        }
    }

    function openReader(preview) {
        if (!currentGallery || !preview) return;
        readerTitle.textContent = currentGallery.title;
        readerPage = null;
        if (!reader.open) reader.showModal();
        loadReaderPage(preview);
    }

    function enterEhviewer() {
        sessionStorage.setItem(CONSENT_KEY, '1');
        consent.hidden = true;
        browser.hidden = false;
        if (!listItems.length) loadList();
    }

    enterButton.addEventListener('click', enterEhviewer);
    searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        activeSearch = searchInput.value.trim();
        nextCursor = null;
        loadList();
    });
    latestButton.addEventListener('click', () => {
        searchInput.value = '';
        activeSearch = '';
        nextCursor = null;
        loadList();
    });
    loadMoreButton.addEventListener('click', () => loadList({ append: true }));
    backButton.addEventListener('click', () => {
        detailRequestId += 1;
        currentGallery = null;
        firstPreview = null;
        showDetail(false);
    });
    previewPrev.addEventListener('click', () => loadPreviewBatch(currentBatch - 1));
    previewNext.addEventListener('click', () => loadPreviewBatch(currentBatch + 1));
    readButton.addEventListener('click', () => openReader(firstPreview));
    readerClose.addEventListener('click', () => reader.close());
    readerPrev.addEventListener('click', () => loadReaderPage(readerPage?.previous));
    readerNext.addEventListener('click', () => loadReaderPage(readerPage?.next));
    readerStage.addEventListener('click', (event) => {
        if (event.target === readerImage && readerPage?.next) loadReaderPage(readerPage.next);
    });
    reader.addEventListener('click', (event) => {
        if (event.target === reader) reader.close();
    });
    reader.addEventListener('close', () => {
        imageRequestId += 1;
        readerImage.removeAttribute('src');
        readerImage.hidden = true;
        readerPage = null;
    });
    document.addEventListener('keydown', (event) => {
        if (!reader.open) return;
        if (event.key === 'ArrowLeft' && readerPage?.previous) {
            event.preventDefault();
            loadReaderPage(readerPage.previous);
        }
        if (event.key === 'ArrowRight' && readerPage?.next) {
            event.preventDefault();
            loadReaderPage(readerPage.next);
        }
    });

    if (sessionStorage.getItem(CONSENT_KEY) === '1') enterEhviewer();
})();
