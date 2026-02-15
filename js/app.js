(() => {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const root = document.documentElement;
        const body = document.body;
        const sections = Array.from(document.querySelectorAll('.section-trigger'));
        const backgrounds = Array.from(document.querySelectorAll('.cinema-bg'));
        const revealItems = Array.from(document.querySelectorAll('.fade-in-up, .scroll-reveal'));
        const parallaxLayers = Array.from(document.querySelectorAll('.parallax-layer'));
        const cards = Array.from(document.querySelectorAll('.glass-card'));
        const scrollyContent = document.querySelector('.scrolly-content');
        const threadSvg = document.getElementById('story-thread-layer');
        const threadPath = document.getElementById('story-thread-path');
        const threadShadow = document.getElementById('story-thread-shadow');
        const threadHead = document.getElementById('story-thread-head');
        const threadHeartLayer = document.getElementById('thread-heart-layer');
        const threadCards = Array.from(document.querySelectorAll('.glass-card.story-card'));

        const progressFill = document.getElementById('progress-fill');
        const scrollIndicator = document.getElementById('scroll-indicator');
        const startStoryBtn = document.getElementById('start-story');
        const magicBtn = document.getElementById('play-magic');
        const finalBurstBtn = document.getElementById('final-burst');
        const toast = document.getElementById('love-toast');
        const burstLayer = document.getElementById('heart-burst-layer');
        const footer = document.querySelector('.footer');
        const rainCanvas = document.getElementById('heart-rain-canvas');
        const bgMusic = document.getElementById('bg-music');
        const musicUnlockBtn = document.getElementById('music-unlock');

        const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

        const state = {
            pointerNormX: 0.5,
            pointerNormY: 0.5,
            scrollProgress: 0,
            reducedMotion: motionQuery.matches,
            activeBg: '',
            loveMode: false,
            mobileOptimized: false
        };

        const threadState = {
            enabled: false,
            totalLength: 0,
            startScroll: 0,
            endScroll: 1,
            lastProgress: -1,
            basePoints: [],
            lastWindUpdate: 0,
            lastEmitAt: 0
        };

        let toastTimeoutId = null;
        let parallaxRaf = 0;
        let scrollRaf = 0;
        const noopRainController = {
            setIntensity: () => { },
            onReduceMotionChange: () => { },
            resize: () => { },
            destroy: () => { }
        };
        let rainController = noopRainController;

        const notes = [
            'Eres mi casualidad favorita.',
            'Contigo todo tiene sentido.',
            'Mi lugar favorito siempre es a tu lado.',
            'Tu sonrisa es mi mejor hogar.',
            'Sigamos escribiendo esta historia.'
        ];

        function refreshDeviceProfile() {
            const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
            const narrowViewport = window.matchMedia('(max-width: 900px)').matches;
            const lowMemory = Number(navigator.deviceMemory || 0) > 0 && Number(navigator.deviceMemory) <= 4;
            const lowCpu = Number(navigator.hardwareConcurrency || 0) > 0 && Number(navigator.hardwareConcurrency) <= 4;
            const nextMode = coarsePointer || narrowViewport || lowMemory || lowCpu;
            const changed = nextMode !== state.mobileOptimized;

            state.mobileOptimized = nextMode;
            body.classList.toggle('mobile-optimized', state.mobileOptimized);
            if (threadHeartLayer) {
                threadHeartLayer.style.display = state.mobileOptimized ? 'none' : '';
            }

            if (changed && state.mobileOptimized && parallaxRaf) {
                window.cancelAnimationFrame(parallaxRaf);
                parallaxRaf = 0;
            }
            if (changed && !state.mobileOptimized && !state.reducedMotion && !parallaxRaf) {
                setupParallax();
            }
            if (changed) {
                syncRainController();
                buildStoryThread();
            }
        }

        function clamp(value, min, max) {
            return Math.min(max, Math.max(min, value));
        }

        function lerp(start, end, factor) {
            return start + (end - start) * factor;
        }

        function buildThreadPathData(points) {
            if (points.length === 0) {
                return '';
            }
            if (points.length === 1) {
                return `M ${points[0].x} ${points[0].y}`;
            }

            let path = `M ${points[0].x} ${points[0].y}`;
            for (let i = 0; i < points.length - 1; i += 1) {
                const p0 = points[i - 1] || points[i];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[i + 2] || p2;

                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;

                path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
            }
            return path;
        }

        function getScrollProgress() {
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            if (maxScroll <= 0) {
                return 0;
            }
            return clamp(window.scrollY / maxScroll, 0, 1);
        }

        function setActiveBackground(bgId) {
            if (!bgId || state.activeBg === bgId) {
                return;
            }
            state.activeBg = bgId;
            backgrounds.forEach((bg) => {
                const isActive = bg.id === bgId;
                bg.classList.toggle('active', isActive);

                const video = bg.querySelector('video');
                if (!video) {
                    return;
                }

                if (isActive) {
                    video.preload = 'metadata';
                    const playPromise = video.play();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(() => { });
                    }
                } else {
                    video.pause();
                    video.preload = 'none';
                }
            });
        }

        function updateProgressBar() {
            state.scrollProgress = getScrollProgress();
            if (progressFill) {
                progressFill.style.width = `${(state.scrollProgress * 100).toFixed(2)}%`;
            }
            root.style.setProperty('--scroll-progress', state.scrollProgress.toFixed(4));
        }

        function getThreadWindStrength(now = performance.now()) {
            const pointerWind = (state.pointerNormX - 0.5) * 2;
            const ambientWind = Math.sin(now * 0.0017) * 0.75;
            const modeBoost = state.loveMode ? 0.2 : 0;
            return clamp(pointerWind + ambientWind, -2, 2) * (1 + modeBoost);
        }

        function createThreadMiniHeart(lengthOnPath, now = performance.now()) {
            if (!threadState.enabled || !threadPath || !threadHeartLayer) {
                return;
            }

            const clampedLength = clamp(lengthOnPath, 0, threadState.totalLength);
            const point = threadPath.getPointAtLength(clampedLength);
            const wind = getThreadWindStrength(now);
            const colors = ['#ff6f95', '#ff8cab', '#ffa5be', '#ffd1df'];
            const horizontalDrift = (wind * (35 + Math.random() * 90)) + ((Math.random() - 0.5) * 28);
            const verticalDrift = -34 - (Math.random() * 62) + (Math.abs(wind) * 20);
            const duration = state.reducedMotion
                ? 900 + Math.random() * 600
                : 1200 + Math.random() * 900;

            const miniHeart = document.createElement('span');
            miniHeart.className = 'thread-mini-heart';
            miniHeart.textContent = Math.random() > 0.24 ? '❤' : '♥';
            miniHeart.style.left = `${point.x.toFixed(2)}px`;
            miniHeart.style.top = `${point.y.toFixed(2)}px`;
            miniHeart.style.setProperty('--mini-size', `${(6 + Math.random() * 8).toFixed(1)}px`);
            miniHeart.style.setProperty('--mini-duration', `${Math.round(duration)}ms`);
            miniHeart.style.setProperty('--mini-tx', `${horizontalDrift.toFixed(2)}px`);
            miniHeart.style.setProperty('--mini-ty', `${verticalDrift.toFixed(2)}px`);
            miniHeart.style.setProperty('--mini-rot', `${Math.round((Math.random() - 0.5) * 160 + wind * 60)}deg`);
            miniHeart.style.setProperty('--mini-color', colors[Math.floor(Math.random() * colors.length)]);
            miniHeart.addEventListener('animationend', () => miniHeart.remove(), { once: true });
            threadHeartLayer.appendChild(miniHeart);
        }

        function emitThreadHearts(now = performance.now()) {
            if (!threadState.enabled || threadState.lastProgress <= 0.015 || state.mobileOptimized) {
                return;
            }

            const gap = state.reducedMotion
                ? 380
                : (state.loveMode ? 95 : 160);
            if (now - threadState.lastEmitAt < gap) {
                return;
            }
            threadState.lastEmitAt = now;

            const visibleLength = threadState.totalLength * threadState.lastProgress;
            const wind = Math.abs(getThreadWindStrength(now));
            const tailWindow = Math.min(visibleLength, 220 + wind * 170);
            const minLength = Math.max(0, visibleLength - tailWindow);
            const heartsCount = state.loveMode ? 2 : 1;

            for (let i = 0; i < heartsCount; i += 1) {
                const lengthOnPath = minLength + (Math.random() * Math.max(2, visibleLength - minLength));
                createThreadMiniHeart(lengthOnPath, now + i * 12);
            }
        }

        function applyWindToThread(now = performance.now(), force = false) {
            if (!threadState.enabled || !threadPath || !threadShadow || threadState.basePoints.length < 2) {
                return;
            }

            const frameGap = state.mobileOptimized ? 180 : (state.reducedMotion ? 130 : 42);
            if (!force && (now - threadState.lastWindUpdate) < frameGap) {
                return;
            }
            threadState.lastWindUpdate = now;

            let pointsForPath = threadState.basePoints;
            if (!state.reducedMotion && !state.mobileOptimized) {
                const wind = getThreadWindStrength(now);
                const windAbs = Math.abs(wind);
                const baseAmplitude = window.innerWidth < 768 ? 4.2 : 7.4;

                pointsForPath = threadState.basePoints.map((point, index, arr) => {
                    const ratio = index / Math.max(1, arr.length - 1);
                    const curveWeight = Math.sin(ratio * Math.PI);
                    const anchorDamping = (index === 0 || index === arr.length - 1) ? 0.35 : 1;
                    const swayAmplitude = (baseAmplitude + windAbs * 3.1) * (0.35 + curveWeight * 0.92) * anchorDamping;
                    const phaseX = (now * 0.0021) + (index * 0.88);
                    const phaseY = (now * 0.00155) + (index * 1.2);

                    const swayX = (Math.sin(phaseX) * swayAmplitude) + (wind * swayAmplitude * 0.78);
                    const swayY = Math.cos(phaseY) * (swayAmplitude * 0.25);

                    return {
                        x: Number((point.x + swayX).toFixed(2)),
                        y: Number((point.y + swayY).toFixed(2))
                    };
                });
            }

            const dynamicPathData = buildThreadPathData(pointsForPath);
            if (!dynamicPathData) {
                return;
            }

            threadPath.setAttribute('d', dynamicPathData);
            threadShadow.setAttribute('d', dynamicPathData);

            const dynamicLength = threadPath.getTotalLength();
            if (!Number.isFinite(dynamicLength) || dynamicLength <= 0) {
                return;
            }

            threadState.totalLength = dynamicLength;
            threadPath.style.strokeDasharray = `${dynamicLength}`;
            threadShadow.style.strokeDasharray = `${dynamicLength}`;

            const progress = threadState.lastProgress < 0 ? 0 : threadState.lastProgress;
            setThreadStrokeProgress(progress);
        }

        function setThreadStrokeProgress(progress) {
            if (!threadState.enabled || !threadPath || !threadShadow) {
                return;
            }

            const safeProgress = clamp(progress, 0, 1);
            const maxLen = Math.max(0, threadState.totalLength - 0.001);
            const drawLength = clamp(threadState.totalLength * safeProgress, 0, maxLen);
            const dashOffset = threadState.totalLength - drawLength;

            threadPath.style.strokeDashoffset = `${dashOffset}`;
            threadShadow.style.strokeDashoffset = `${dashOffset}`;

            if (!threadHead) {
                return;
            }
            if (safeProgress <= 0.001) {
                threadHead.style.opacity = '0';
                return;
            }

            const point = threadPath.getPointAtLength(drawLength);
            threadHead.setAttribute('cx', point.x.toFixed(2));
            threadHead.setAttribute('cy', point.y.toFixed(2));
            threadHead.style.opacity = safeProgress >= 0.02 ? '1' : '0';
        }

        function updateStoryThreadProgress() {
            if (!threadState.enabled) {
                return;
            }
            const totalRange = threadState.endScroll - threadState.startScroll;
            const progress = totalRange <= 0
                ? 1
                : clamp((window.scrollY - threadState.startScroll) / totalRange, 0, 1);

            if (Math.abs(progress - threadState.lastProgress) < 0.001) {
                return;
            }
            threadState.lastProgress = progress;
            setThreadStrokeProgress(progress);
            emitThreadHearts(performance.now());
        }

        function buildStoryThread() {
            if (!scrollyContent || !threadSvg || !threadPath || !threadShadow || threadCards.length < 2) {
                threadState.enabled = false;
                threadState.basePoints = [];
                return;
            }

            const contentRect = scrollyContent.getBoundingClientRect();
            const contentTopDoc = contentRect.top + window.scrollY;
            const contentHeight = Math.max(scrollyContent.scrollHeight, scrollyContent.offsetHeight);
            const contentWidth = scrollyContent.clientWidth || window.innerWidth;

            threadSvg.setAttribute('viewBox', `0 0 ${contentWidth} ${Math.ceil(contentHeight)}`);
            threadSvg.setAttribute('width', `${contentWidth}`);
            threadSvg.setAttribute('height', `${Math.ceil(contentHeight)}`);

            const points = threadCards.map((card, index) => {
                const rect = card.getBoundingClientRect();
                const centerX = rect.left + (rect.width / 2);
                const centerYDoc = rect.top + window.scrollY + (rect.height / 2);
                const centerY = centerYDoc - contentTopDoc;
                const maxOffset = window.innerWidth < 768 ? 96 : 190;
                const sideOffset = clamp(rect.width * 0.30, 64, maxOffset);
                const direction = index % 2 === 0 ? -1 : 1;
                const x = clamp(centerX + (direction * sideOffset), 24, contentWidth - 24);

                return {
                    x: Number(x.toFixed(2)),
                    y: Number(centerY.toFixed(2))
                };
            });

            if (points.length < 2) {
                threadState.enabled = false;
                threadState.basePoints = [];
                return;
            }

            const startLift = clamp(window.innerHeight * 0.15, 68, 170);
            points.unshift({
                x: points[0].x,
                y: Number(Math.max(18, points[0].y - startLift).toFixed(2))
            });

            const pathData = buildThreadPathData(points);
            if (!pathData) {
                threadState.enabled = false;
                threadState.basePoints = [];
                return;
            }

            threadState.basePoints = points.map((point) => ({ x: point.x, y: point.y }));
            threadPath.setAttribute('d', pathData);
            threadShadow.setAttribute('d', pathData);

            const totalLength = threadPath.getTotalLength();
            if (!Number.isFinite(totalLength) || totalLength <= 0) {
                threadState.enabled = false;
                threadState.basePoints = [];
                return;
            }

            threadState.enabled = true;
            threadState.totalLength = totalLength;
            threadState.lastProgress = -1;
            threadState.lastWindUpdate = 0;
            threadState.lastEmitAt = 0;

            threadPath.style.strokeDasharray = `${totalLength}`;
            threadShadow.style.strokeDasharray = `${totalLength}`;

            const firstRect = threadCards[0].getBoundingClientRect();
            const lastRect = threadCards[threadCards.length - 1].getBoundingClientRect();
            const firstCenterY = firstRect.top + window.scrollY + (firstRect.height / 2);
            const lastCenterY = lastRect.top + window.scrollY + (lastRect.height / 2);

            threadState.startScroll = firstCenterY - (window.innerHeight * 0.78);
            threadState.endScroll = lastCenterY - (window.innerHeight * 0.36);

            if (threadState.endScroll <= threadState.startScroll + 1) {
                threadState.endScroll = threadState.startScroll + 1;
            }

            setThreadStrokeProgress(0);
            updateStoryThreadProgress();
            applyWindToThread(performance.now(), true);
        }

        function revealElement(element) {
            element.classList.add('is-visible');
            const parentSection = element.closest('.section-trigger');
            if (parentSection) {
                parentSection.classList.add('is-visible');
            }
        }

        function setupSectionObserver() {
            const sceneObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) {
                        return;
                    }
                    const targetBg = entry.target.getAttribute('data-bg');
                    setActiveBackground(targetBg);
                    entry.target.classList.add('is-visible');
                });
            }, {
                threshold: [0.2, 0.45, 0.75],
                rootMargin: '-35% 0px -35% 0px'
            });

            sections.forEach((section) => sceneObserver.observe(section));
        }

        function setupRevealObserver() {
            const revealObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) {
                        return;
                    }
                    revealElement(entry.target);
                    observer.unobserve(entry.target);
                });
            }, {
                threshold: 0.16,
                rootMargin: '0px 0px -6% 0px'
            });

            revealItems.forEach((item) => revealObserver.observe(item));
        }

        function setupFooterObserver() {
            if (!footer) {
                return;
            }
            const footerObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    footer.classList.toggle('footer-live', entry.isIntersecting);
                });
            }, { threshold: 0.42 });

            footerObserver.observe(footer);
        }

        function setupPointerTracking() {
            const updatePointer = (clientX, clientY) => {
                state.pointerNormX = clamp(clientX / window.innerWidth, 0, 1);
                state.pointerNormY = clamp(clientY / window.innerHeight, 0, 1);
                root.style.setProperty('--pointer-x', state.pointerNormX.toFixed(4));
                root.style.setProperty('--pointer-y', state.pointerNormY.toFixed(4));
            };

            let lastPointerFrame = 0;
            window.addEventListener('pointermove', (event) => {
                const now = performance.now();
                const throttle = state.mobileOptimized ? 42 : 0;
                if (throttle > 0 && now - lastPointerFrame < throttle) {
                    return;
                }
                lastPointerFrame = now;
                updatePointer(event.clientX, event.clientY);
            }, { passive: true });

            if (!state.mobileOptimized) {
                window.addEventListener('touchmove', (event) => {
                    const touch = event.touches[0];
                    if (touch) {
                        updatePointer(touch.clientX, touch.clientY);
                    }
                }, { passive: true });
            }
        }

        function setupParallax() {
            let currentX = 0;
            let currentY = 0;

            const frame = (now) => {
                const targetX = (state.pointerNormX - 0.5) * 2;
                const targetY = (state.pointerNormY - 0.5) * 2;
                const smoothFactor = state.reducedMotion ? 0.06 : 0.12;

                currentX = lerp(currentX, targetX, smoothFactor);
                currentY = lerp(currentY, targetY, smoothFactor);

                const scrollBias = state.scrollProgress * 2 - 1;

                parallaxLayers.forEach((layer) => {
                    const depth = Number(layer.dataset.depth || '0');
                    const translateX = currentX * depth * 65;
                    const translateY = (currentY * depth * 42) - (scrollBias * depth * 78);
                    const scale = 1 + depth * 0.08;
                    layer.style.transform = `translate3d(${translateX.toFixed(2)}px, ${translateY.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`;
                });

                applyWindToThread(now);
                emitThreadHearts(now);

                parallaxRaf = window.requestAnimationFrame(frame);
            };

            if (!state.reducedMotion && !state.mobileOptimized) {
                parallaxRaf = window.requestAnimationFrame(frame);
            }
        }

        function showToast(message) {
            if (!toast) {
                return;
            }
            toast.textContent = message;
            toast.classList.add('visible');
            if (toastTimeoutId) {
                window.clearTimeout(toastTimeoutId);
            }
            toastTimeoutId = window.setTimeout(() => {
                toast.classList.remove('visible');
            }, 1900);
        }

        function setupBackgroundMusic() {
            if (!bgMusic) {
                return;
            }

            bgMusic.volume = 0.62;

            const hideUnlockButton = () => {
                if (!musicUnlockBtn) {
                    return;
                }
                musicUnlockBtn.hidden = true;
            };

            const showUnlockButton = () => {
                if (!musicUnlockBtn) {
                    return;
                }
                musicUnlockBtn.hidden = false;
            };

            const tryPlay = () => {
                const playPromise = bgMusic.play();
                if (!playPromise || typeof playPromise.catch !== 'function') {
                    hideUnlockButton();
                    return;
                }

                playPromise
                    .then(() => {
                        hideUnlockButton();
                    })
                    .catch(() => {
                        showToast('Toca la pantalla para iniciar la musica');
                        showUnlockButton();
                    });
            };

            bgMusic.addEventListener('error', () => {
                showToast('No se pudo cargar el audio');
                showUnlockButton();
            });

            const unlockAudio = () => {
                tryPlay();
            };

            if (musicUnlockBtn) {
                musicUnlockBtn.addEventListener('click', unlockAudio);
            }

            window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
            window.addEventListener('keydown', unlockAudio, { once: true });
            window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });

            tryPlay();
        }

        function createHeartBurst(x, y, count = 16, radius = 130) {
            if (!burstLayer) {
                return;
            }

            const safeCount = state.mobileOptimized ? Math.max(6, Math.round(count * 0.55)) : count;
            const safeRadius = state.mobileOptimized ? radius * 0.72 : radius;
            const palette = ['#ff5d81', '#ff6f95', '#ff86a8', '#ffabc1', '#ffd5de'];

            for (let i = 0; i < safeCount; i += 1) {
                const heart = document.createElement('span');
                const angle = (Math.PI * 2 * i / safeCount) + Math.random() * 0.6;
                const distance = safeRadius * (0.52 + Math.random() * 0.68);
                const tx = Math.cos(angle) * distance;
                const ty = Math.sin(angle) * distance - (Math.random() * 35);

                heart.className = 'burst-heart';
                heart.textContent = Math.random() > 0.3 ? '❤' : '♥';
                heart.style.left = `${x}px`;
                heart.style.top = `${y}px`;
                heart.style.setProperty('--tx', `${tx.toFixed(2)}px`);
                heart.style.setProperty('--ty', `${ty.toFixed(2)}px`);
                heart.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 120)}deg`);
                heart.style.setProperty('--size', `${Math.round(13 + Math.random() * 20)}px`);
                heart.style.setProperty('--duration', `${Math.round(850 + Math.random() * 500)}ms`);
                heart.style.setProperty('--color', palette[Math.floor(Math.random() * palette.length)]);

                heart.addEventListener('animationend', () => heart.remove(), { once: true });
                burstLayer.appendChild(heart);
            }
        }

        function setupCardInteractions() {
            cards.forEach((card, index) => {
                const resetCard = () => {
                    card.style.transform = '';
                };

                card.addEventListener('pointermove', (event) => {
                    if (state.reducedMotion || window.innerWidth < 768) {
                        return;
                    }

                    const rect = card.getBoundingClientRect();
                    const offsetX = (event.clientX - rect.left) / rect.width;
                    const offsetY = (event.clientY - rect.top) / rect.height;
                    const rotateY = (offsetX - 0.5) * 10;
                    const rotateX = (0.5 - offsetY) * 9;

                    card.style.transform = `perspective(1100px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px)`;
                });

                card.addEventListener('pointerleave', resetCard);
                card.addEventListener('blur', resetCard, true);

                card.addEventListener('click', () => {
                    const rect = card.getBoundingClientRect();
                    createHeartBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 12, 100);
                    showToast(notes[index % notes.length]);
                    card.classList.add('is-pulsing');
                    window.setTimeout(() => card.classList.remove('is-pulsing'), 640);
                });
            });
        }

        function goToStorySection() {
            const firstSection = document.querySelector('.story-section');
            if (!firstSection) {
                return;
            }
            firstSection.scrollIntoView({
                behavior: state.reducedMotion ? 'auto' : 'smooth',
                block: 'start'
            });
        }

        function toggleLoveMode() {
            state.loveMode = !state.loveMode;
            body.classList.toggle('love-mode', state.loveMode);
            if (magicBtn) {
                magicBtn.textContent = state.loveMode ? 'Bajar intensidad' : 'Encender magia';
            }
            rainController.setIntensity(state.mobileOptimized ? (state.loveMode ? 0.85 : 0.42) : (state.loveMode ? 1.65 : 1));
            const centerX = window.innerWidth * 0.5;
            const centerY = window.innerHeight * 0.38;
            createHeartBurst(centerX, centerY, state.loveMode ? 28 : 16, state.loveMode ? 220 : 130);
        }

        function setupControls() {
            if (startStoryBtn) {
                startStoryBtn.addEventListener('click', goToStorySection);
            }
            if (scrollIndicator) {
                scrollIndicator.addEventListener('click', goToStorySection);
                scrollIndicator.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        goToStorySection();
                    }
                });
            }
            if (magicBtn) {
                magicBtn.addEventListener('click', toggleLoveMode);
            }
            if (finalBurstBtn) {
                finalBurstBtn.addEventListener('click', () => {
                    rainController.setIntensity(state.mobileOptimized ? 0.95 : 2.2);
                    createHeartBurst(window.innerWidth * 0.5, window.innerHeight * 0.45, 42, 250);
                    showToast('Cada latido te celebra.');
                    window.setTimeout(() => {
                        rainController.setIntensity(state.mobileOptimized ? (state.loveMode ? 0.85 : 0.42) : (state.loveMode ? 1.65 : 1));
                    }, 2200);
                });
            }

            window.addEventListener('click', (event) => {
                if (state.mobileOptimized) {
                    return;
                }
                const interactive = event.target.closest('button, .glass-card, .scroll-indicator');
                if (interactive) {
                    return;
                }
                createHeartBurst(event.clientX, event.clientY, 10, 90);
            });

            window.addEventListener('dblclick', (event) => {
                if (state.mobileOptimized) {
                    return;
                }
                createHeartBurst(event.clientX, event.clientY, 26, 180);
            });
        }

        function createHeartRain(canvas, localState) {
            if (!canvas || !canvas.getContext) {
                return {
                    setIntensity: () => { },
                    onReduceMotionChange: () => { },
                    resize: () => { },
                    destroy: () => { }
                };
            }

            const ctx = canvas.getContext('2d');
            const palette = [
                [255, 100, 139],
                [255, 126, 156],
                [255, 153, 181],
                [255, 186, 199],
                [255, 215, 227]
            ];

            let width = 0;
            let height = 0;
            let dpr = 1;
            let intensity = 1;
            let hearts = [];
            let baseCount = 0;
            let rafId = 0;
            let lastTime = performance.now();

            function rand(min, max) {
                return min + Math.random() * (max - min);
            }

            function resetHeart(heart, initial) {
                heart.depth = Math.random();
                heart.size = 5 + heart.depth * 18;
                heart.x = rand(-40, width + 40);
                heart.y = initial ? rand(-height, height) : rand(-140, -20);
                heart.vy = (0.8 + heart.depth * 2.2) * (localState.reducedMotion ? 0.75 : 1);
                heart.vx = rand(-0.38, 0.38) * (0.4 + heart.depth);
                heart.wobble = rand(0, Math.PI * 2);
                heart.wobbleSpeed = rand(0.008, 0.03);
                heart.wobbleAmp = rand(4, 16) * (0.32 + heart.depth);
                heart.rotation = rand(-0.3, 0.3);
                heart.spin = rand(-0.013, 0.013);
                heart.opacity = rand(0.38, 0.88);
                heart.color = palette[Math.floor(Math.random() * palette.length)];
            }

            function makeHeart(initial) {
                const heart = {};
                resetHeart(heart, initial);
                return heart;
            }

            function syncHeartCount() {
                const target = Math.max(
                    localState.reducedMotion ? 12 : 22,
                    Math.round(baseCount * intensity)
                );

                while (hearts.length < target) {
                    hearts.push(makeHeart(true));
                }
                while (hearts.length > target) {
                    hearts.pop();
                }
            }

            function resize() {
                dpr = Math.min(window.devicePixelRatio || 1, localState.mobileOptimized ? 1.2 : 2);
                width = window.innerWidth;
                height = window.innerHeight;

                canvas.width = Math.floor(width * dpr);
                canvas.height = Math.floor(height * dpr);
                canvas.style.width = `${width}px`;
                canvas.style.height = `${height}px`;

                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

                const area = width * height;
                baseCount = localState.reducedMotion
                    ? Math.max(10, Math.floor(area / 110000))
                    : (localState.mobileOptimized
                        ? Math.max(14, Math.floor(area / 90000))
                        : Math.max(26, Math.floor(area / 52000)));

                syncHeartCount();
            }

            function drawHeartShape(x, y, size, rotation, rgb, alpha) {
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(rotation);
                const scale = size / 18;
                ctx.scale(scale, scale);

                ctx.globalAlpha = alpha;
                ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
                ctx.shadowColor = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.42)`;
                ctx.shadowBlur = localState.mobileOptimized ? 0 : 10;

                ctx.beginPath();
                ctx.moveTo(0, 5);
                ctx.bezierCurveTo(0, -4, -10, -10, -16, -2);
                ctx.bezierCurveTo(-21, 5, -15, 14, 0, 21);
                ctx.bezierCurveTo(15, 14, 21, 5, 16, -2);
                ctx.bezierCurveTo(10, -10, 0, -4, 0, 5);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            function tick(now) {
                const delta = Math.min((now - lastTime) / 16.67, 2.4);
                lastTime = now;
                const wind = ((localState.pointerNormX - 0.5) * 1.2) + Math.sin(now * 0.0013) * 0.08;

                ctx.clearRect(0, 0, width, height);

                hearts.forEach((heart) => {
                    heart.wobble += heart.wobbleSpeed * delta;
                    heart.rotation += heart.spin * delta;
                    heart.x += (heart.vx + wind * (0.12 + heart.depth * 0.2)) * delta;
                    heart.y += heart.vy * delta;

                    const drawX = heart.x + Math.sin(heart.wobble) * heart.wobbleAmp;
                    drawHeartShape(
                        drawX,
                        heart.y,
                        heart.size,
                        heart.rotation,
                        heart.color,
                        heart.opacity * (localState.loveMode ? 1 : 0.88)
                    );

                    if (heart.y > height + 50 || heart.x < -60 || heart.x > width + 60) {
                        resetHeart(heart, false);
                    }
                });

                rafId = window.requestAnimationFrame(tick);
            }

            function setIntensity(value) {
                intensity = clamp(value, 0.4, 2.8);
                syncHeartCount();
            }

            function onReduceMotionChange() {
                resize();
            }

            function destroy() {
                if (rafId) {
                    window.cancelAnimationFrame(rafId);
                    rafId = 0;
                }
                hearts = [];
                ctx.clearRect(0, 0, width, height);
            }

            resize();
            rafId = window.requestAnimationFrame(tick);

            return {
                setIntensity,
                onReduceMotionChange,
                resize,
                destroy
            };
        }

        function syncRainController() {
            if (rainCanvas) {
                rainCanvas.style.display = '';
            }
            if (rainController === noopRainController) {
                rainController = createHeartRain(rainCanvas, state);
            }
            rainController.setIntensity(state.mobileOptimized ? (state.loveMode ? 0.85 : 0.42) : (state.loveMode ? 1.65 : 1));
        }

        motionQuery.addEventListener('change', (event) => {
            state.reducedMotion = event.matches;
            syncRainController();
            rainController.onReduceMotionChange();
            if (state.reducedMotion && parallaxRaf) {
                window.cancelAnimationFrame(parallaxRaf);
                parallaxRaf = 0;
            }
            if (!state.reducedMotion && !state.mobileOptimized && !parallaxRaf) {
                setupParallax();
            }
            applyWindToThread(performance.now(), true);
        });

        let resizeRaf = 0;
        const runScrollWork = () => {
            scrollRaf = 0;
            updateProgressBar();
            updateStoryThreadProgress();
        };
        const handleScroll = () => {
            if (scrollRaf) {
                return;
            }
            scrollRaf = window.requestAnimationFrame(runScrollWork);
        };
        const handleResize = () => {
            if (resizeRaf) {
                window.cancelAnimationFrame(resizeRaf);
            }
            resizeRaf = window.requestAnimationFrame(() => {
                refreshDeviceProfile();
                updateProgressBar();
                rainController.resize();
                buildStoryThread();
            });
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', handleResize);

        refreshDeviceProfile();
        syncRainController();
        setActiveBackground('bg-hero');
        setupSectionObserver();
        setupRevealObserver();
        setupFooterObserver();
        setupPointerTracking();
        setupParallax();
        setupCardInteractions();
        setupControls();
        setupBackgroundMusic();
        buildStoryThread();
        handleScroll();

        window.setTimeout(buildStoryThread, 360);
    });
})();
