/**
 * PapaCheck Landing Page — Interactions
 * Scroll reveal, navbar shadow, smooth anchor scrolling, hero parallax
 */
document.addEventListener('DOMContentLoaded', function () {
    var navbar = document.getElementById('navbar');
    var hero = document.getElementById('hero');
    var revealEls = document.querySelectorAll('.reveal');
    var parallaxEls = document.querySelectorAll('[data-parallax]');

    /* ---- Navbar scroll shadow ---- */
    function handleNavbarScroll() {
        if (window.scrollY > 20) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }

    /* ---- Hero Parallax ---- */
    var ticking = false;
    function updateParallax() {
        if (!hero) return;

        var heroTop = hero.offsetTop;
        var heroHeight = hero.offsetHeight;
        var scrollY = window.scrollY;
        var heroScroll = scrollY - heroTop;

        // Only apply within hero bounds
        if (heroScroll > -200 && heroScroll < heroHeight) {
            // Move floating elements at different speeds
            for (var i = 0; i < parallaxEls.length; i++) {
                var el = parallaxEls[i];
                var speed = parseFloat(el.getAttribute('data-parallax')) || 0.05;
                var offset = heroScroll * speed;
                el.style.transform = 'translateY(' + offset + 'px)';
            }

            // Shift notebook texture background
            var textureOffset = heroScroll * 0.03;
            var heroStyle = hero.style;
            heroStyle.setProperty('--texture-shift', textureOffset + 'px');
        }
        ticking = false;
    }

    function onScroll() {
        handleNavbarScroll();
        if (!ticking) {
            requestAnimationFrame(updateParallax);
            ticking = true;
        }
    }

    /* ---- Scroll Reveal (Intersection Observer) ---- */
    var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                var el = entry.target;
                var delay = parseInt(el.dataset.delay) || 0;
                setTimeout(function () {
                    el.classList.add('visible');
                }, delay);
                observer.unobserve(el);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    });

    revealEls.forEach(function (el) { observer.observe(el); });

    /* ---- Smooth scroll for anchor links ---- */
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
        link.addEventListener('click', function (e) {
            var targetId = link.getAttribute('href');
            if (targetId === '#') return;

            e.preventDefault();
            var target = document.querySelector(targetId);
            if (target) {
                var navbarHeight = 64;
                var targetPosition = target.getBoundingClientRect().top + window.scrollY - navbarHeight;
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    /* ---- Event listeners ---- */
    window.addEventListener('scroll', onScroll, { passive: true });

    /* ---- Initial call ---- */
    handleNavbarScroll();
    updateParallax();
});
