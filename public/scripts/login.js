        // Already logged in? Bounce straight back to the app instead of showing the login
        // form. This is what actually stops "back"/swipe-back or a cached copy of this page
        // from stranding an authenticated user here - location.replace() on the login side
        // only stops *new* logins from stacking history, it can't rewrite history that
        // already exists or block the browser from restoring a cached login page.
        if (localStorage.getItem("loggedInUser")) {
            window.location.replace("/");
        }

        // Swipe-back / back-button navigation is frequently served from the browser's
        // bfcache, which restores the page WITHOUT re-running the script above. This
        // listener catches that specific case and re-checks once the page is shown.
        window.addEventListener("pageshow", (event) => {
            if (event.persisted && localStorage.getItem("loggedInUser")) {
                window.location.replace("/");
            }
        });

        // --- CUSTOM ALERT (replaces the native browser alert) ---
        let dialogResolve = null;

        function showAlert(message) {
            return new Promise((resolve) => {
                dialogResolve = resolve;
                document.getElementById('dialogMessage').textContent = message;
                const modal = document.getElementById('dialogModal');
                modal.style.display = 'flex';
                setTimeout(() => modal.classList.add('show'), 10);
            });
        }

        function dialogRespond(confirmed) {
            const modal = document.getElementById('dialogModal');
            modal.classList.remove('show');
            setTimeout(() => {
                // Don't hide it if a new dialog has reopened it in the meantime.
                if (!modal.classList.contains('show')) modal.style.display = 'none';
            }, 300);
            if (dialogResolve) {
                const resolve = dialogResolve;
                dialogResolve = null;
                resolve(confirmed);
            }
        }

        function openRegisterModal() {
            const modal = document.getElementById("registerModal");
            modal.style.display = "flex";
            setTimeout(() => modal.classList.add("show"), 10);
        }

        function closeRegisterModal() {
            const modal = document.getElementById("registerModal");
            modal.classList.remove("show");
            setTimeout(() => modal.style.display = "none", 300);
        }

        document.getElementById("loginForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const username = document.getElementById("username").value.trim();
            const password = document.getElementById("password").value.trim();

            const res = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();
            if (data.success) {
                localStorage.setItem("loggedInUser", data.username);
                localStorage.setItem("isAdmin", data.isAdmin ? "true" : "false");
                // Replace (not push) so the login page isn't left behind in browser history -
                // otherwise pressing "back" from the app lands you back on the login screen.
                window.location.replace("/");
            } else {
                await showAlert(data.message);
            }
        });

        async function registerUser() {
            const username = document.getElementById("regUsername").value.trim();
            const password = document.getElementById("regPassword").value.trim();
            const confirmPassword = document.getElementById("regConfirmPassword").value.trim();

            if (!username || !password) return await showAlert("Please fill all fields");
            if (password !== confirmPassword) return await showAlert("Passwords do not match");

            const res = await fetch("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            if (res.ok) {
                await showAlert("Account created successfully.");
                closeRegisterModal();
            } else {
                const data = await res.json();
                await showAlert(data.message);
            }
        }
