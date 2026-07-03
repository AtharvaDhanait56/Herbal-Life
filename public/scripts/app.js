        const currentUser = localStorage.getItem("loggedInUser");
        const isAdmin = localStorage.getItem("isAdmin") === "true";

        // --- CUSTOM ALERT / CONFIRM / PROMPT (replaces native browser dialogs) ---
        let dialogResolve = null;
        let dialogMode = 'alert';

        function openDialog({ message, mode, defaultValue = '', inputType = 'text' }) {
            return new Promise((resolve) => {
                dialogResolve = resolve;
                dialogMode = mode;

                document.getElementById('dialogMessage').textContent = message;
                document.getElementById('dialogError').style.display = 'none';

                const inputWrap = document.getElementById('dialogInputWrap');
                const input = document.getElementById('dialogInput');
                if (mode === 'prompt') {
                    inputWrap.style.display = 'block';
                    input.type = inputType;
                    input.value = defaultValue;
                } else {
                    inputWrap.style.display = 'none';
                }

                document.getElementById('dialogCancelBtn').style.display = mode === 'alert' ? 'none' : 'inline-flex';
                document.getElementById('dialogConfirmBtn').textContent = mode === 'confirm' ? 'Confirm' : 'OK';

                const modalEl = document.getElementById('dialogModal');
                modalEl.style.display = 'flex';
                setTimeout(() => {
                    modalEl.classList.add('show');
                    if (mode === 'prompt') { input.focus(); input.select(); }
                }, 10);
            });
        }

        function dialogRespond(confirmed) {
            const modalEl = document.getElementById('dialogModal');
            modalEl.classList.remove('show');
            setTimeout(() => {
                // If a new dialog opened (e.g. a chained "deleted successfully" alert right
                // after a confirm) it will have re-added 'show' by now - don't hide it out
                // from under itself just because THIS dialog's own close animation finished.
                if (!modalEl.classList.contains('show')) modalEl.style.display = 'none';
            }, 200);

            if (!dialogResolve) return;
            const resolve = dialogResolve;
            dialogResolve = null;

            if (dialogMode === 'prompt') {
                resolve(confirmed ? document.getElementById('dialogInput').value : null);
            } else {
                resolve(confirmed);
            }
        }

        document.getElementById('dialogInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); dialogRespond(true); }
            if (e.key === 'Escape') { e.preventDefault(); dialogRespond(false); }
        });

        function showAlert(message) {
            return openDialog({ message, mode: 'alert' });
        }

        function showConfirm(message) {
            return openDialog({ message, mode: 'confirm' });
        }

        function showPrompt(message, defaultValue = '', inputType = 'text') {
            return openDialog({ message, mode: 'prompt', defaultValue, inputType });
        }

        document.addEventListener("DOMContentLoaded", () => {
            const manageProductsBtn = document.getElementById('manageProductsBtn');
            if (manageProductsBtn && !isAdmin) {
                manageProductsBtn.disabled = true;
                manageProductsBtn.title = 'Only admins can manage products.';
            }
        });

        const currencyFormatter = new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: 2
        });

        function updateFinancialOverview(bills) {
            const totalPurchaseCost = bills.reduce((sum, bill) => sum + (Number(bill.total_payable) || 0), 0);
            const totalReceived = bills.reduce((sum, bill) => sum + (Number(bill.paid_amount) || 0), 0);
            const paidPurchaseCost = bills.reduce((sum, bill) => {
                return bill.payment_status === 'PAID' ? sum + (Number(bill.total_payable) || 0) : sum;
            }, 0);
            const unpaidPurchaseCost = bills.reduce((sum, bill) => {
                return bill.payment_status !== 'PAID' ? sum + (Number(bill.total_payable) || 0) : sum;
            }, 0);
            const paidProfit = totalReceived - paidPurchaseCost;

            document.getElementById('overviewPurchaseCost').textContent = currencyFormatter.format(totalPurchaseCost);
            document.getElementById('overviewReceived').textContent = currencyFormatter.format(totalReceived);
            document.getElementById('overviewProfit').textContent = currencyFormatter.format(paidProfit);
            document.getElementById('overviewUnpaidCost').textContent = currencyFormatter.format(unpaidPurchaseCost);
            const profitCard = document.getElementById('overviewProfitCard');
            profitCard.classList.toggle('negative', paidProfit < 0);
            profitCard.querySelector('.finance-icon').textContent = paidProfit < 0 ? '📉' : '📈';
        }

        function compactHistoryToolbar() {
            const searchBox = document.querySelector('.history-search-container');
            const toolbar = document.querySelector('.history-filter-toolbar');
            if (searchBox && toolbar && searchBox.parentElement !== toolbar) {
                toolbar.prepend(searchBox);
            }
        }

        document.addEventListener("DOMContentLoaded", () => {
            document.getElementById("userDisplay").textContent =
                `Logged in as: ${currentUser}`;
            compactHistoryToolbar();
        });

        if (!currentUser) {
            // Replace (not push) so this unauthenticated page isn't left in browser history.
            window.location.replace("/pages/login.html");
        }

        // If this page is restored from the browser's bfcache (common on back/forward or
        // swipe-back navigation), the script above does NOT re-run. Re-check localStorage
        // directly each time the page is shown so a logged-out session can't be left visible.
        window.addEventListener("pageshow", (event) => {
            if (event.persisted && !localStorage.getItem("loggedInUser")) {
                window.location.replace("/pages/login.html");
            }
        });
        // Product catalog is loaded from /api/products (see loadProductCatalog()); keyed the same way
        // the old hardcoded list was ("SKU - NAME") so the rest of the invoice logic barely changes.
        let productCatalog = {};
        let productsById = {};
        let activeTomSelects = [];

        async function loadProductCatalog() {
            try {
                const response = await fetch('/api/products');
                const products = await response.json();
                productCatalog = {};
                productsById = {};
                products.forEach(p => {
                    const key = `${p.sku} - ${p.name}`;
                    const entry = { id: p.id, sku: p.sku, name: p.name, costPrice: Number(p.cost_price) };
                    productCatalog[key] = entry;
                    productsById[p.id] = entry;
                });
            } catch (err) {
                console.error(err);
                await showAlert('Unable to load the product catalog. Please check that the billing server is running.');
            }
        }

        function productOptionsHTML() {
            return Object.keys(productCatalog)
                .sort((a, b) => {
                    const nameA = a.replace(/^[^-]+-\s*/, '').trim();
                    const nameB = b.replace(/^[^-]+-\s*/, '').trim();
                    return nameA.localeCompare(nameB);
                })
                .map(product => `<option value="${product}">${product}</option>`)
                .join('');
        }

        const productRowsContainer = document.getElementById('productRows');
        const addTrackBtn = document.getElementById('addTrackBtn');

        const grandTotalEl = document.getElementById('grandTotal');
        const grandDiscountEl = document.getElementById('grandDiscount');
        const grandTaxableEl = document.getElementById('grandTaxable');
        const grandPayableEl = document.getElementById('grandPayable');

        function addNewRow() {

            const selectId = 'product_' + Date.now() + Math.floor(Math.random() * 1000);

            const newRow = document.createElement('tr');
            newRow.className = 'product-row';

            newRow.innerHTML = `
        <td>
            <select id="${selectId}" class="prod-search-input">
                <option value="">Select Product</option>
                ${productOptionsHTML()}
            </select>
        </td>
        <td><input type="number" class="prod-price" placeholder="0.00" min="0" step="0.01"></td>
        <td><input type="number" class="prod-qty" value="1" min="0" step="1"></td>
        <td><span class="display-val row-total">₹0.00</span></td>
        <td><span class="display-val row-discount">₹0.00</span></td>
        <td><span class="display-val row-taxable">₹0.00</span></td>
        <td><span class="display-val row-payable">₹0.00</span></td>
        <td style="text-align:center;" data-html2pdf-ignore="true">
            <button class="btn-delete" onclick="deleteRow(this)">✕</button>
        </td>
    `;

            productRowsContainer.appendChild(newRow);

            const tomSelectInstance = new TomSelect(`#${selectId}`, {
                create: false,
                searchField: ['text'],
                placeholder: 'Search Product...',
                maxOptions: 100,
                dropdownParent: 'body',
                maxItems: 1,
                hideSelected: true,
                closeAfterSelect: true
            });
            activeTomSelects.push(tomSelectInstance);

            calculateInvoice();
        }

        function calculateInvoice() {
            const rows = document.querySelectorAll('.product-row');
            let aggregateTotal = 0, aggregateDiscount = 0, aggregateTaxable = 0, aggregatePayable = 0;

            rows.forEach(row => {
                const price = parseFloat(row.querySelector('.prod-price').value) || 0;
                const qty = parseInt(row.querySelector('.prod-qty').value) || 0;

                const total = price * qty;
                const discount = (0.359 * total);
                const taxable = total - discount;
                const payable = taxable + (0.05 * taxable);

                aggregateTotal += total;
                aggregateDiscount += discount;
                aggregateTaxable += taxable;
                aggregatePayable += payable;

                row.querySelector('.row-total').textContent = '₹' + total.toFixed(2);
                row.querySelector('.row-discount').textContent = '₹' + discount.toFixed(2);
                row.querySelector('.row-taxable').textContent = '₹' + taxable.toFixed(2);
                row.querySelector('.row-payable').textContent = '₹' + payable.toFixed(2);
            });

            grandTotalEl.textContent = aggregateTotal.toFixed(2);
            grandDiscountEl.textContent = aggregateDiscount.toFixed(2);
            grandTaxableEl.textContent = aggregateTaxable.toFixed(2);
            grandPayableEl.textContent = aggregatePayable.toFixed(2);
        }

        productRowsContainer.addEventListener('change', (e) => {
            if (e.target.classList.contains('prod-search-input')) {
                const inputValue = e.target.value;
                const product = productCatalog[inputValue];
                if (product) {
                    const row = e.target.closest('tr');
                    row.querySelector('.prod-price').value = product.costPrice;
                    e.target.setAttribute('data-oldval', inputValue);
                    calculateInvoice();
                }
            }
            if (e.target.classList.contains('prod-price') || e.target.classList.contains('prod-qty')) {
                calculateInvoice();
            }
        });

        function deleteRow(buttonElement) {
            buttonElement.closest('tr').remove();
            calculateInvoice();
        }

        function logout() {
            localStorage.removeItem("loggedInUser");
            localStorage.removeItem("isAdmin");
            // Replace (not push) so "back" after logging out can't return to the app's last state.
            window.location.replace("/pages/login.html");
        }

        async function saveBillToDatabase() {
            const customerName = document.getElementById('customerName').value.trim();
            if (!customerName) {
                await showAlert("Please fill out the Customer Name before saving.");
                return;
            }

            const rows = document.querySelectorAll('.product-row');
            if (rows.length === 0) {
                await showAlert("Cannot save an empty bill.");
                return;
            }

            const items = [];
            rows.forEach(row => {
                const description = row.querySelector('.prod-search-input').value || "Unselected Item";
                const price = parseFloat(row.querySelector('.prod-price').value) || 0;
                const qty = parseInt(row.querySelector('.prod-qty').value) || 0;
                if (price > 0 && qty > 0) {
                    items.push({ description, price, qty });
                }
            });

            const billingPayload = {
                username: currentUser,
                customerName,
                items,
                grandTotal: parseFloat(grandTotalEl.textContent),
                totalDiscount: parseFloat(grandDiscountEl.textContent),
                totalTaxable: parseFloat(grandTaxableEl.textContent),
                totalPayable: parseFloat(grandPayableEl.textContent)
            };

            try {
                const response = await fetch('/api/save-bill', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(billingPayload)
                });

                const result = await response.json();
                if (response.ok) {
                    const customDisplayId = `INV-100${result.billId}`;
                    await showAlert(`Invoice saved successfully. Reference: ${customDisplayId}`);

                    // Clear customer name
                    document.getElementById('customerName').value = '';

                    // Remove all product rows
                    productRowsContainer.innerHTML = '';

                    // Add one fresh empty row
                    addNewRow();

                    // Reset summary values
                    calculateInvoice();
                }
                else {
                    await showAlert(`Unable to save invoice: ${result.error}`);
                }
            } catch (err) {
                console.error(err);
                await showAlert("Unable to connect. Please check that the billing server is running.");
            }
        }

        // --- FETCH RECORDS AND BUILD ACCORDION WITH ACTIONS ---
        async function fetchSavedBills() {
            try {
                const response = await fetch(`/api/get-bills/${encodeURIComponent(currentUser)}`);
                const bills = await response.json();

                if (!response.ok) {
                    await showAlert("Unable to load saved invoices.");
                    return;
                }

                updateFinancialOverview(bills);

                document.getElementById('modalSearchInput').value = '';
                document.getElementById('paymentStatusFilter').value = 'ALL';
                document.getElementById('historySortSelect').value = 'newest';

                const rowsContainer = document.getElementById('savedBillsRows');
                rowsContainer.innerHTML = '';

                if (bills.length === 0) {
                    rowsContainer.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--dk-ink-500); padding:20px;">No saved invoices found in database.</td></tr>`;
                }

                bills.forEach(bill => {
                    let itemsList = [];
                    try {
                        itemsList = typeof bill.items === 'string' ? JSON.parse(bill.items) : bill.items;
                    } catch (e) {
                        itemsList = [];
                    }

                    // Legacy bills saved before selling price existed fall back to showing purchase cost.
                    const effectiveSelling = (bill.selling_total !== null && bill.selling_total !== undefined)
                        ? Number(bill.selling_total)
                        : Number(bill.total_payable);

                    const dateFormatted = new Date(bill.created_at).toLocaleString();
                    const professionalInvoiceNum = `INV-100${bill.id}`;
                    const isPaid = bill.payment_status === 'PAID';
                    const paidAmount = isPaid ? (parseFloat(bill.paid_amount) || effectiveSelling || 0) : 0;
                    const paymentBadge = isPaid
                        ? `<div class="paid-badge">PAID<span class="payment-amount">₹${paidAmount.toFixed(2)}</span></div>`
                        : `<div class="unpaid-badge">UNPAID</div>`;
                    const paidAction = isPaid
                        ? `<button class="btn-history-paid is-paid" disabled title="This bill is paid">✓ Paid</button>`
                        : `<button class="btn-history-paid" onclick="togglePaymentEntry(event, ${bill.id})" title="Enter amount and mark as paid">✓ Paid</button>
                           <form class="payment-popover" id="payment-entry-${bill.id}" onsubmit="submitPaidAmount(event, ${bill.id}, ${effectiveSelling})" onclick="event.stopPropagation()">
                               <label class="payment-popover-label" for="paid-amount-${bill.id}">Amount received · Minimum ₹${effectiveSelling.toFixed(2)}</label>
                               <div class="payment-input-wrap"><span>₹</span><input id="paid-amount-${bill.id}" type="number" min="${effectiveSelling.toFixed(2)}" step="0.01" value="${effectiveSelling.toFixed(2)}" required></div>
                               <div class="payment-popover-controls">
                                   <button type="button" class="payment-cancel" onclick="closePaymentEntry(event, ${bill.id})">Cancel</button>
                                   <button type="submit" class="payment-save">Save</button>
                               </div>
                               <span class="payment-error"></span>
                           </form>`;

                    // 1. Summary Main History Row
                    const mainRow = document.createElement('tr');
                    mainRow.className = `clickable-bill-row${isPaid ? ' bill-paid' : ''}`;
                    mainRow.setAttribute('data-customer', bill.customer_name.toLowerCase());
                    mainRow.setAttribute('data-id', professionalInvoiceNum.toLowerCase());
                    mainRow.setAttribute('data-status', isPaid ? 'PAID' : 'UNPAID');
                    mainRow.setAttribute('data-created', new Date(bill.created_at).getTime() || 0);
                    mainRow.setAttribute('data-payable', effectiveSelling || 0);

                    const paidAtIso = bill.paid_at ? new Date(bill.paid_at).toISOString() : null;

                    mainRow.innerHTML = `
                    <td style="font-weight:bold; color:#a5b4fc;">${professionalInvoiceNum}</td>
                    <td style="color:var(--dk-ink-800); font-weight:500;">👤 ${bill.customer_name}</td>
                    <td class="display-val">₹${parseFloat(bill.grand_total).toFixed(2)}</td>
                    <td class="display-val" style="color:var(--dk-ink-500);">₹${parseFloat(bill.total_payable).toFixed(2)}</td>
                    <td class="display-val">
                        <span style="color:#34d399; font-weight:700;">₹${effectiveSelling.toFixed(2)}</span>
                        <button class="btn-history-setprice" style="display:block; margin-top:6px;" onclick="setBillSellingPrice(${bill.id}, ${effectiveSelling}); event.stopPropagation();" title="Set the selling price charged to this customer">
                            Set Price
                        </button>
                    </td>
                    <td style="text-align:center;">${paymentBadge}</td>
                    <td style="color:var(--dk-ink-500); font-size:13px;">${dateFormatted} <span class="row-expand-arrow">🔽</span></td>
                    <td style="text-align:center;">
                        <div class="history-actions-cell">
                            ${paidAction}
                            <button class="btn-history-download" onclick="downloadSingleHistoryPDF('${professionalInvoiceNum}', '${bill.customer_name.replace(/'/g, "\\'")}', ${JSON.stringify(itemsList).replace(/"/g, '&quot;')}, ${bill.grand_total}, ${bill.total_discount}, ${bill.total_taxable}, ${bill.total_payable}, '${bill.payment_status || 'UNPAID'}', ${paidAmount}, ${effectiveSelling}, '${new Date(bill.created_at).toISOString()}', ${paidAtIso ? `'${paidAtIso}'` : 'null'}); event.stopPropagation();">
                                ↓ PDF
                            </button>
                            <button class="btn-history-delete" onclick="deleteBillFromDatabase(${bill.id}, '${bill.customer_name.replace(/'/g, "\\'")}', '${professionalInvoiceNum}'); event.stopPropagation();">
                                Delete
                            </button>
                        </div>
                    </td>
                `;

                    // 2. Dropdown Itemized Breakdown Container
                    const detailsRow = document.createElement('tr');
                    detailsRow.className = 'details-row';
                    detailsRow.style.display = 'none';

                    let itemsTableHTML = `
                    <div class="details-container">
                        <strong>Invoice Items</strong>
                        <table class="inner-details-table">
                            <thead>
                                <tr>
                                    <th style="width: 30%;">Product Name</th>
                                    <th style="width: 12%; text-align: right;">List Price (₹)</th>
                                    <th style="width: 8%; text-align: center;">Qty</th>
                                    <th style="width: 16%; text-align: right;">List Total</th>
                                    <th style="width: 17%; text-align: right;">Member Discount</th>
                                    <th style="width: 17%; text-align: right;">Purchase Cost</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                    itemsList.forEach(item => {
                        const total = item.price * item.qty;
                        const discount = total * 0.359;
                        const taxable = total - discount;
                        const payable = taxable * 1.05;

                        itemsTableHTML += `
                        <tr>
                            <td style="font-weight: 500;">${item.description}</td>
                            <td style="text-align: right;">₹${parseFloat(item.price).toFixed(2)}</td>
                            <td style="text-align: center; font-weight: 600;">${item.qty}</td>
                            <td style="text-align: right;">₹${total.toFixed(2)}</td>
                            <td style="text-align: right; color: #f87171;">₹${discount.toFixed(2)}</td>
                            <td style="text-align: right; font-weight: 600;">₹${payable.toFixed(2)}</td>
                        </tr>
                    `;
                    });

                    itemsTableHTML += `
                            </tbody>
                        </table>
                        <div style="margin-top: 12px; display: flex; justify-content: flex-end; gap: 25px; font-size: 13px; color: var(--dk-ink-800); background: rgba(255,255,255,.04); padding: 10px; border-radius: 4px; border: 1px solid var(--dk-line);">
                            <span><strong>List Total:</strong> ₹${parseFloat(bill.grand_total).toFixed(2)}</span>
                            <span style="color: #f87171;"><strong>Member Discount:</strong> ₹${parseFloat(bill.total_discount).toFixed(2)}</span>
                            <span style="color: var(--dk-ink-500);"><strong>Purchase Cost:</strong> ₹${parseFloat(bill.total_payable).toFixed(2)}</span>
                            <span style="color: #34d399;"><strong>Selling Price (customer):</strong> ₹${effectiveSelling.toFixed(2)}</span>
                            ${isPaid ? `<span style="color:#6ee7b7;"><strong>Customer Paid:</strong> ₹${paidAmount.toFixed(2)}</span>` : `<span style="color:#fca5a5;"><strong>Awaiting Payment</strong></span>`}
                        </div>
                    </div>
                `;

                    detailsRow.innerHTML = `<td colspan="8" style="padding: 0;">${itemsTableHTML}</td>`;

                    // Main Accordion Click Toggle
                    mainRow.addEventListener('click', () => {
                        const isHidden = detailsRow.style.display === 'none';
                        detailsRow.style.display = isHidden ? 'table-row' : 'none';
                        mainRow.style.backgroundColor = isHidden ? 'rgba(255,255,255,.06)' : '';
                        mainRow.classList.toggle('row-expanded', isHidden);
                    });

                    rowsContainer.appendChild(mainRow);
                    rowsContainer.appendChild(detailsRow);
                });

                applyHistoryControls();
                const billsModalEl = document.getElementById('billsModal');
                billsModalEl.style.display = 'flex';
                setTimeout(() => billsModalEl.classList.add('show'), 10);

            } catch (err) {
                console.error(err);
                await showAlert("Network error. Ensure your backend Node server is running.");
            }
        }

        function sortStoredBills() {
            const rowsContainer = document.getElementById('savedBillsRows');
            const sortMode = document.getElementById('historySortSelect')?.value || 'newest';
            const mainRows = Array.from(rowsContainer.querySelectorAll('.clickable-bill-row'));

            mainRows.sort((a, b) => {
                if (sortMode === 'oldest') return Number(a.dataset.created) - Number(b.dataset.created);
                if (sortMode === 'amountHigh') return Number(b.dataset.payable) - Number(a.dataset.payable);
                if (sortMode === 'amountLow') return Number(a.dataset.payable) - Number(b.dataset.payable);
                if (sortMode === 'customerAZ') return (a.dataset.customer || '').localeCompare(b.dataset.customer || '');
                return Number(b.dataset.created) - Number(a.dataset.created);
            });

            mainRows.forEach(row => {
                const detailsRow = row.nextElementSibling;
                rowsContainer.appendChild(row);
                if (detailsRow && detailsRow.classList.contains('details-row')) {
                    rowsContainer.appendChild(detailsRow);
                }
            });
        }

        function updateHistoryResultSummary(visibleRows, totalRows) {
            const summaryEl = document.getElementById('historyResultSummary');
            if (!summaryEl) return;

            const allRows = Array.from(document.querySelectorAll('.clickable-bill-row'));
            const paidCount = allRows.filter(row => row.dataset.status === 'PAID').length;
            const unpaidCount = allRows.filter(row => row.dataset.status === 'UNPAID').length;
            summaryEl.textContent = `Showing ${visibleRows} of ${totalRows} invoices · Paid: ${paidCount} · Unpaid: ${unpaidCount}`;
        }

        function applyHistoryControls() {
            sortStoredBills();
            filterStoredBills();
        }

        // --- CLIENT-SIDE SEARCH AND PAID/UNPAID FILTER ALGORITHM ---
        function filterStoredBills() {
            const query = document.getElementById('modalSearchInput').value.toLowerCase().trim();
            const statusFilter = document.getElementById('paymentStatusFilter')?.value || 'ALL';
            const rowsContainer = document.getElementById('savedBillsRows');
            document.getElementById('historyNoResultsRow')?.remove();
            const mainRows = document.querySelectorAll('.clickable-bill-row');
            let visibleRows = 0;

            mainRows.forEach(row => {
                const customerData = row.getAttribute('data-customer') || "";
                const idData = row.getAttribute('data-id') || "";
                const statusData = row.getAttribute('data-status') || "UNPAID";
                const detailsRow = row.nextElementSibling;
                const matchesText = customerData.includes(query) || idData.includes(query);
                const matchesStatus = statusFilter === 'ALL' || statusData === statusFilter;

                if (matchesText && matchesStatus) {
                    row.style.display = 'table-row';
                    visibleRows += 1;
                } else {
                    row.style.display = 'none';
                    if (detailsRow && detailsRow.classList.contains('details-row')) {
                        detailsRow.style.display = 'none';
                    }
                }
            });

            if (visibleRows === 0 && mainRows.length > 0) {
                const noResultsRow = document.createElement('tr');
                noResultsRow.id = 'historyNoResultsRow';
                noResultsRow.innerHTML = `<td colspan="8" style="text-align:center; color:var(--dk-ink-500); padding:22px;">No invoices match the selected search/filter.</td>`;
                rowsContainer.appendChild(noResultsRow);
            }

            updateHistoryResultSummary(visibleRows, mainRows.length);
        }

        // --- FRONTEND ACTION TO MARK A BILL AS PAID ---
        function togglePaymentEntry(event, billId) {
            event.stopPropagation();
            const target = document.getElementById(`payment-entry-${billId}`);
            const shouldOpen = !target.classList.contains('is-open');

            document.querySelectorAll('.payment-popover.is-open').forEach(panel => panel.classList.remove('is-open'));
            if (shouldOpen) {
                target.classList.add('is-open');
                const input = target.querySelector('input');
                input.focus();
                input.select();
            }
        }

        function closePaymentEntry(event, billId) {
            event.stopPropagation();
            document.getElementById(`payment-entry-${billId}`).classList.remove('is-open');
        }

        document.addEventListener('click', () => {
            document.querySelectorAll('.payment-popover.is-open').forEach(panel => panel.classList.remove('is-open'));
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                document.querySelectorAll('.payment-popover.is-open').forEach(panel => panel.classList.remove('is-open'));
            }
        });

        async function submitPaidAmount(event, billId, netPayable) {
            event.preventDefault();
            event.stopPropagation();

            const panel = event.currentTarget;
            const input = panel.querySelector('input');
            const errorEl = panel.querySelector('.payment-error');
            const saveButton = panel.querySelector('.payment-save');
            const amount = Number(input.value);

            errorEl.style.display = 'none';
            if (!Number.isFinite(amount) || amount < netPayable) {
                errorEl.textContent = `Enter at least ₹${netPayable.toFixed(2)}.`;
                errorEl.style.display = 'block';
                input.focus();
                return;
            }

            saveButton.disabled = true;
            saveButton.textContent = 'Saving…';

            try {
                const response = await fetch(`/api/bills/${billId}/paid`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: currentUser, amount })
                });
                const result = await response.json();

                if (!response.ok) {
                    errorEl.textContent = result.error || 'Unable to mark this bill as paid.';
                    errorEl.style.display = 'block';
                    return;
                }

                await fetchSavedBills();
            } catch (err) {
                console.error(err);
                errorEl.textContent = 'Unable to connect to the server.';
                errorEl.style.display = 'block';
            } finally {
                saveButton.disabled = false;
                saveButton.textContent = 'Save';
            }
        }

        // --- SET THE SELLING PRICE CHARGED TO THE CUSTOMER FOR A SAVED INVOICE ---
        async function setBillSellingPrice(billId, currentEffective) {
            const promptDefault = currentEffective ? currentEffective.toFixed(2) : '';
            const input = await showPrompt('Enter the selling price charged to this customer:', promptDefault, 'number');
            if (input === null) return;

            const value = parseFloat(input);
            if (!Number.isFinite(value) || value <= 0) {
                await showAlert('Enter a valid selling price.');
                return;
            }

            try {
                const response = await fetch(`/api/bills/${billId}/selling-total`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: currentUser, sellingTotal: value })
                });
                const result = await response.json();
                if (!response.ok) {
                    await showAlert(`Unable to set price: ${result.error}`);
                    return;
                }
                await fetchSavedBills();
            } catch (err) {
                console.error(err);
                await showAlert('Unable to connect. Please check that the billing server is running.');
            }
        }

        // --- FRONTEND ACTION TO DELETE A RECORD FROM THE MYSQL DATABASE ---
        async function deleteBillFromDatabase(billId, customerName, displayId) {
            const confirmDelete = await showConfirm(
                `Are you sure you want to permanently delete the bill ${displayId} for "${customerName}" from the database?`
            );

            if (!confirmDelete) return;

            try {
                const response = await fetch(
                    `/api/delete-bill/${billId}/${currentUser}`,
                    {
                        method: "DELETE"
                    }
                );

                const result = await response.json();

                if (response.ok) {
                    // Refresh the list right away rather than waiting for the alert to be
                    // dismissed, so it's already up to date by the time the user sees it again.
                    fetchSavedBills();
                    await showAlert(`Record ${displayId} deleted successfully.`);
                } else {
                    await showAlert(`Database error: ${result.error}`);
                }

            } catch (err) {
                console.error(err);
                await showAlert("Connection refused. Ensure your backend Node server is running.");
            }
        }

        function closeModal() {
            const billsModalEl = document.getElementById('billsModal');
            billsModalEl.classList.remove('show');
            setTimeout(() => { billsModalEl.style.display = 'none'; }, 220);
        }

        // --- GENERATES CUSTOMER-FACING INVOICES WITHOUT INTERNAL PURCHASE COST WORDING ---
        function legacyDownloadSingleHistoryPDF(invoiceNum, customerName, items, gross, discount, taxable, payable, paymentStatus, paidAmount) {
            const tempDiv = document.createElement('div');
            tempDiv.style.padding = '28px';
            tempDiv.style.backgroundColor = '#ffffff';
            tempDiv.style.fontFamily = "'Segoe UI', system-ui, sans-serif";

            let tableRowsHTML = '';
            items.forEach(item => {
                const total = item.price * item.qty;
                const discVal = total * 0.359;
                const taxAmt = total - discVal;
                const netPay = taxAmt * 1.05;
                tableRowsHTML += `
                <tr style="page-break-inside: avoid; break-inside: avoid;">
                    <td style="padding:10px; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:500;">${item.description}</td>
                    <td style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:12px;">₹${parseFloat(item.price).toFixed(2)}</td>
                    <td style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:center; font-size:12px; font-weight:600;">${item.qty}</td>
                    <td style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:12px;">₹${total.toFixed(2)}</td>
                    <td style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:12px; color:#dc2626;">₹${discVal.toFixed(2)}</td>
                    <td style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:12px;">₹${taxAmt.toFixed(2)}</td>
                    <td style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:12px; font-weight:600; color:#059669;">₹${netPay.toFixed(2)}</td>
                </tr>
            `;
            });

            tempDiv.innerHTML = `
            <div style="text-align:center; border-bottom:2px solid #1e293b; padding-bottom:15px; margin-bottom:20px; page-break-inside: avoid; break-inside: avoid;">
                <h2 style="margin:0; color:#1e293b; font-size:26px; letter-spacing:0.5px;">CUSTOMER INVOICE</h2>
                <p style="margin:5px 0 0 0; color:#64748b; font-size:13px;">Herbal Life Products &nbsp;|&nbsp; Invoice Number: ${invoiceNum} &nbsp;|&nbsp; Date: ${new Date().toLocaleDateString('en-IN')}</p>
            </div>
            <div style="margin-bottom:25px; font-size:14px; background:#f8fafc; padding:15px; border-radius:6px; border:1px solid #e2e8f0; color:#1e293b; page-break-inside: avoid; break-inside: avoid;">
                <strong>Customer Name:</strong> ${customerName}
                <span style="float:right; color:${paymentStatus === 'PAID' ? '#047857' : '#b91c1c'}; font-weight:700;">
                    ${paymentStatus === 'PAID' ? `PAID · ₹${Number(paidAmount).toFixed(2)}` : 'UNPAID'}
                </span>
            </div>
            <table style="width:100%; border-collapse:collapse; margin-bottom:25px;">
                <thead>
                    <tr style="background-color:#1e293b; color:#ffffff; font-size:11px; text-transform:uppercase;">
                        <th style="padding:12px 10px; text-align:left;">Product Description</th>
                        <th style="padding:12px 10px; text-align:right;">List Price</th>
                        <th style="padding:12px 10px; text-align:center;">Qty</th>
                        <th style="padding:12px 10px; text-align:right;">List Total</th>
                        <th style="padding:12px 10px; text-align:right;">Member Discount</th>
                        <th style="padding:12px 10px; text-align:right;">Discounted Amount</th>
                        <th style="padding:12px 10px; text-align:right;">Amount Payable</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHTML}
                </tbody>
            </table>
            <div style="display:flex; justify-content:flex-end; page-break-inside: avoid; break-inside: avoid;">
                <div style="width:300px; background:#f8fafc; padding:18px; border-radius:8px; border-top:4px solid #10b981; box-shadow:0 4px 10px rgba(0,0,0,0.03); border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0;">
                    <div style="display:flex; justify-content:space-between; gap:20px; font-size:13px; color:#475569; margin-bottom:8px;">
                        <span style="flex-grow:1;">Total List Price:</span><strong>₹${parseFloat(gross).toFixed(2)}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; gap:20px; font-size:13px; color:#dc2626; margin-bottom:8px;">
                        <span style="flex-grow:1;">Member Discount:</span><strong>₹${parseFloat(discount).toFixed(2)}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; gap:20px; font-size:13px; color:#475569; margin-bottom:8px;">
                        <span style="flex-grow:1;">Discounted Subtotal:</span><strong>₹${parseFloat(taxable).toFixed(2)}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; gap:20px; font-size:16px; color:#1e293b; font-weight:700; border-top:1px dashed #cbd5e1; padding-top:12px; margin-top:12px;">
                        <span style="flex-grow:1;">Total Amount Payable:</span><span style="color:#059669; font-size:18px;">₹${parseFloat(payable).toFixed(2)}</span>
                    </div>
                </div>
            </div>
            <div style="margin-top:22px; padding-top:12px; border-top:1px solid #e2e8f0; text-align:center; color:#64748b; font-size:11px; page-break-inside: avoid; break-inside: avoid;">
                Thank you for your purchase.
            </div>
        `;

            const opt = {
                margin: [12, 10, 16, 10],
                filename: `Invoice_${customerName.replace(/\s+/g, '_')}_${invoiceNum}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: {
                    scale: 1.35,
                    useCORS: true
                },
                pagebreak: {
                    mode: ['css', 'legacy']
                },
                jsPDF: {
                    unit: 'mm',
                    format: 'a4',
                    orientation: 'landscape'
                }
            };

            tempDiv.style.width = "960px";

            html2pdf().set(opt).from(tempDiv).save();
        }

        // Customer-safe PDF layout: hides internal discount, discounted subtotal, and purchase-cost math.
        function downloadSingleHistoryPDF(invoiceNum, customerName, items, gross, discount, taxable, payable, paymentStatus, paidAmount, sellingTotalRaw, createdAt, paidAt) {
            const tempDiv = document.createElement('div');
            tempDiv.style.padding = '0';
            tempDiv.style.backgroundColor = '#ffffff';
            tempDiv.style.fontFamily = "'Segoe UI', Arial, sans-serif";
            tempDiv.style.width = "680px";

            // Legacy bills saved before selling price existed fall back to the derived cost-based total.
            const sellingTotal = (sellingTotalRaw !== null && sellingTotalRaw !== undefined && sellingTotalRaw !== '')
                ? Number(sellingTotalRaw)
                : Number(payable);

            // No per-item selling price is tracked - the customer is charged one final price per
            // invoice (set via "Set Price"), so the item list here is just what was purchased.
            let tableRowsHTML = '';
            items.forEach(item => {
                const qty = Number(item.qty) || 0;
                tableRowsHTML += `
                <tr style="page-break-inside: avoid; break-inside: avoid;">
                    <td style="padding:12px 14px; border-bottom:1px solid #e5edf0; font-size:12px; font-weight:600; color:#25332e;">${item.description}</td>
                    <td style="padding:12px 14px; border-bottom:1px solid #e5edf0; text-align:center; font-size:12px; font-weight:700; color:#25332e;">${qty}</td>
                </tr>`;
            });

            const isPaid = paymentStatus === 'PAID';
            const paidDisplay = Number(paidAmount) || sellingTotal || 0;
            const invoiceDate = createdAt ? new Date(createdAt).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
            const paidDateHTML = (isPaid && paidAt)
                ? `<div style="margin-top:4px;"><span style="opacity:.72;">Paid on</span> <strong>${new Date(paidAt).toLocaleDateString('en-IN')}</strong></div>`
                : '';

            tempDiv.innerHTML = `
            <div style="border:1px solid #dbe8e1; border-radius:18px; overflow:hidden; background:#ffffff;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:24px; padding:28px 30px; background:linear-gradient(135deg,#0b2b1f,#087a4f); color:#ffffff; page-break-inside: avoid; break-inside: avoid;">
                    <div>
                        <div style="font-size:11px; font-weight:800; letter-spacing:2px; text-transform:uppercase; opacity:.78;">Herbal Life Products</div>
                        <h2 style="margin:7px 0 0; color:#ffffff; font-size:28px; letter-spacing:-0.6px;">Customer Invoice</h2>
                        <p style="margin:8px 0 0; color:#dff8eb; font-size:12px;">Thank you for your purchase.</p>
                    </div>
                    <div style="text-align:right; font-size:12px; line-height:1.8;">
                        <div><span style="opacity:.72;">Invoice No.</span> <strong>${invoiceNum}</strong></div>
                        <div><span style="opacity:.72;">Date</span> <strong>${invoiceDate}</strong></div>
                        <div style="display:inline-block; margin-top:8px; padding:5px 10px; border-radius:999px; background:${isPaid ? '#dff8eb' : '#fff4df'}; color:${isPaid ? '#087a4f' : '#a96310'}; font-weight:800;">
                            ${isPaid ? 'PAID' : 'UNPAID'}
                        </div>
                        ${paidDateHTML}
                    </div>
                </div>

                <div style="display:flex; justify-content:space-between; gap:18px; padding:22px 30px; background:#f8fbf9; border-bottom:1px solid #e2eee7; page-break-inside: avoid; break-inside: avoid;">
                    <div>
                        <div style="color:#64748b; font-size:10px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">Bill To</div>
                        <div style="margin-top:6px; color:#1e293b; font-size:16px; font-weight:800;">${customerName}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="color:#64748b; font-size:10px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">Total Amount</div>
                        <div style="margin-top:5px; color:#087a4f; font-size:24px; font-weight:900;">₹${sellingTotal.toFixed(2)}</div>
                    </div>
                </div>

                <div style="padding:24px 30px 10px;">
                    <table style="width:100%; border-collapse:separate; border-spacing:0; margin-bottom:24px; border:1px solid #dbe8e1; border-radius:12px; overflow:hidden;">
                        <thead>
                            <tr style="background-color:#eef7f1; color:#345247; font-size:10px; text-transform:uppercase; letter-spacing:.7px;">
                                <th style="padding:13px 14px; text-align:left;">Product</th>
                                <th style="padding:13px 14px; text-align:center; width:100px;">Qty</th>
                            </tr>
                        </thead>
                        <tbody>${tableRowsHTML}</tbody>
                    </table>

                    <div style="display:flex; justify-content:flex-end; page-break-inside: avoid; break-inside: avoid;">
                        <div style="width:310px; background:#f8fbf9; padding:18px 20px; border-radius:14px; border:1px solid #dbe8e1;">
                            <div style="display:flex; justify-content:space-between; gap:20px; align-items:center; font-size:13px; color:#475569;">
                                <span style="flex-grow:1;">Invoice Total</span>
                                <strong style="font-size:20px; color:#087a4f;">₹${sellingTotal.toFixed(2)}</strong>
                            </div>
                            ${isPaid ? `<div style="margin-top:10px; padding-top:10px; border-top:1px dashed #cbd5e1; display:flex; justify-content:space-between; gap:20px; font-size:12px; color:#047857;"><span>Amount Received</span><strong>₹${paidDisplay.toFixed(2)}</strong></div>` : ''}
                        </div>
                    </div>
                </div>

                <div style="display:flex; justify-content:space-between; gap:20px; padding:16px 30px 22px; border-top:1px solid #e2eee7; color:#64748b; font-size:11px; page-break-inside: avoid; break-inside: avoid;">
                    <span>Customer copy - prices shown are final customer payable amounts.</span>
                    <span style="font-weight:700; color:#087a4f;">Thank you!</span>
                </div>
            </div>`;

            const opt = {
                margin: [8, 8, 8, 8],
                filename: `Invoice_${customerName.replace(/\s+/g, '_')}_${invoiceNum}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: {
                    scale: 1.2,
                    useCORS: true
                },
                pagebreak: {
                    mode: ['css']
                },
                jsPDF: {
                    unit: 'mm',
                    format: 'a4',
                    orientation: 'portrait'
                }
            };

            html2pdf().set(opt).from(tempDiv).save();
        }

        // --- MANAGE PRODUCTS MODAL ---

        let currentDetailProductId = null;

        function renderProductsModalList() {
            const rowsContainer = document.getElementById('productsListRows');
            const products = Object.values(productsById).sort((a, b) => a.name.localeCompare(b.name));

            if (products.length === 0) {
                rowsContainer.innerHTML = `<div class="product-card-empty">No products yet. Add one above.</div>`;
            } else {
                rowsContainer.innerHTML = products.map(p => `
                    <div class="product-card" data-search="${(p.sku + ' ' + p.name).toLowerCase()}" onclick="openProductDetail(${p.id})">
                        <div class="product-card-avatar" aria-hidden="true">${p.name.charAt(0).toUpperCase()}</div>
                        <div class="product-card-summary-info">
                            <strong>${p.name}</strong>
                            <span>${p.sku} · ₹${p.costPrice}</span>
                        </div>
                        <div class="product-card-quick-actions">
                            <button class="btn-edit-toggle" onclick="openProductDetail(${p.id}, true); event.stopPropagation();">Edit</button>
                            <button class="btn-history-delete" onclick="deleteProduct(${p.id}); event.stopPropagation();">Delete</button>
                        </div>
                    </div>
                `).join('');
            }

            filterProductCards();
        }

        function filterProductCards() {
            const query = (document.getElementById('productSearchInput')?.value || '').toLowerCase().trim();
            document.querySelectorAll('#productsListRows .product-card').forEach(card => {
                const matches = !query || card.dataset.search.includes(query);
                card.style.display = matches ? '' : 'none';
            });
        }

        // --- PRODUCT DETAIL POPUP (opened by clicking a card, instead of expanding it inline) ---
        function openProductDetail(productId, startInEdit = false) {
            const product = productsById[productId];
            if (!product) return;
            currentDetailProductId = productId;

            document.getElementById('productDetailAvatar').textContent = product.name.charAt(0).toUpperCase();
            document.getElementById('productDetailTitle').textContent = product.name;
            document.getElementById('productDetailMeta').textContent = `${product.sku} · ₹${product.costPrice}`;

            const skuInput = document.getElementById('productDetailSku');
            const nameInput = document.getElementById('productDetailName');
            const costInput = document.getElementById('productDetailCost');
            skuInput.value = product.sku;
            nameInput.value = product.name;
            costInput.value = product.costPrice;
            [skuInput, nameInput, costInput].forEach(input => input.disabled = !startInEdit);

            document.getElementById('productDetailEditBtn').textContent = startInEdit ? 'Update' : 'Edit';

            const modalEl = document.getElementById('productDetailModal');
            modalEl.style.display = 'flex';
            setTimeout(() => {
                modalEl.classList.add('show');
                if (startInEdit) skuInput.focus();
            }, 10);
        }

        function closeProductDetailModal() {
            const modalEl = document.getElementById('productDetailModal');
            modalEl.classList.remove('show');
            setTimeout(() => { modalEl.style.display = 'none'; }, 200);
            currentDetailProductId = null;
        }

        async function toggleProductDetailEdit() {
            const editBtn = document.getElementById('productDetailEditBtn');
            const skuInput = document.getElementById('productDetailSku');
            const nameInput = document.getElementById('productDetailName');
            const costInput = document.getElementById('productDetailCost');

            if (editBtn.textContent.trim() === 'Edit') {
                [skuInput, nameInput, costInput].forEach(input => input.disabled = false);
                editBtn.textContent = 'Update';
                skuInput.focus();
                return;
            }

            const success = await updateProduct(
                currentDetailProductId,
                skuInput.value.trim(),
                nameInput.value.trim(),
                parseFloat(costInput.value)
            );
            if (success) closeProductDetailModal();
        }

        async function deleteProductFromDetail() {
            if (currentDetailProductId === null) return;
            const success = await deleteProduct(currentDetailProductId);
            if (success) closeProductDetailModal();
        }

        async function addProduct() {
            const sku = document.getElementById('newProductSku').value.trim();
            const name = document.getElementById('newProductName').value.trim();
            const costPrice = parseFloat(document.getElementById('newProductCost').value);

            if (!sku || !name || !Number.isFinite(costPrice)) {
                await showAlert('Please fill out SKU, name and cost price.');
                return;
            }

            try {
                const response = await fetch('/api/products', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sku, name, costPrice, username: currentUser })
                });
                const result = await response.json();
                if (!response.ok) {
                    await showAlert(`Unable to add product: ${result.error}`);
                    return;
                }

                document.getElementById('newProductSku').value = '';
                document.getElementById('newProductName').value = '';
                document.getElementById('newProductCost').value = '';

                await loadProductCatalog();
                renderProductsModalList();

                const newKey = `${sku} - ${name}`;
                activeTomSelects.forEach(ts => ts.addOption({ value: newKey, text: newKey }));

                await showAlert(`"${name}" was added to the catalog.`);
            } catch (err) {
                console.error(err);
                await showAlert('Unable to connect. Please check that the billing server is running.');
            }
        }

        async function updateProduct(productId, sku, name, costPrice) {
            if (!sku || !name || !Number.isFinite(costPrice)) {
                await showAlert('Please fill out SKU, name and cost price.');
                return false;
            }

            try {
                const response = await fetch(`/api/products/${productId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sku, name, costPrice, username: currentUser })
                });
                const result = await response.json();
                if (!response.ok) {
                    await showAlert(`Unable to update product: ${result.error}`);
                    return false;
                }
                await loadProductCatalog();
                renderProductsModalList();
                return true;
            } catch (err) {
                console.error(err);
                await showAlert('Unable to connect. Please check that the billing server is running.');
                return false;
            }
        }

        async function deleteProduct(productId) {
            if (!(await showConfirm('Delete this product? This cannot be undone.'))) return false;

            try {
                const response = await fetch(`/api/products/${productId}?username=${encodeURIComponent(currentUser)}`, { method: 'DELETE' });
                const result = await response.json();
                if (!response.ok) {
                    await showAlert(`Unable to delete product: ${result.error}`);
                    return false;
                }
                await loadProductCatalog();
                renderProductsModalList();
                return true;
            } catch (err) {
                console.error(err);
                await showAlert('Unable to connect. Please check that the billing server is running.');
                return false;
            }
        }

        async function openProductsModal() {
            if (!isAdmin) {
                await showAlert('Only admins can manage products.');
                return;
            }
            const searchInput = document.getElementById('productSearchInput');
            if (searchInput) searchInput.value = '';
            renderProductsModalList();
            const productsModalEl = document.getElementById('productsModal');
            productsModalEl.style.display = 'flex';
            setTimeout(() => productsModalEl.classList.add('show'), 10);
        }

        function closeProductsModal() {
            const productsModalEl = document.getElementById('productsModal');
            productsModalEl.classList.remove('show');
            setTimeout(() => { productsModalEl.style.display = 'none'; }, 220);
        }

        addTrackBtn.addEventListener('click', addNewRow);
        loadProductCatalog().then(() => addNewRow());
