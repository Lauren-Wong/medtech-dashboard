/**
 * DocuSign Navigator API Service - Implicit Grant Version
 * Optimized for GitHub Pages and static hosting
 * Uses Implicit Grant flow (no backend required)
 */

class NavigatorAPIServiceImplicit {
    constructor() {
        this.baseURL = 'https://demo.docusign.net/restapi/v2.1';
        this.navigatorURL = 'https://api-d.docusign.com/v1';
        this.accessToken = null;
        this.accountId = null;
        this.cache = new Map();
        this.lastSyncTime = null;
    }

    /**
     * OAuth 2.0 Implicit Grant Flow
     */
    
    // Initiate OAuth implicit grant flow
    initiateOAuthImplicit(clientId, redirectUri) {
        const state = this.generateRandomString(32);
        sessionStorage.setItem('oauth_state', state);
        
        const authURL = 'https://account-d.docusign.com/oauth/auth';
        const params = new URLSearchParams({
            response_type: 'token',  // Implicit grant uses 'token' not 'code'
            scope: 'signature extended adm_store_unified_repo_read models_read public_dms_document_read',
            client_id: clientId,
            redirect_uri: redirectUri,
            state: state
        });
        
        console.log('Redirecting to DocuSign auth:', authURL);
        window.location.href = `${authURL}?${params.toString()}`;
    }
    
    // Handle OAuth callback (token in URL hash)
    handleOAuthCallback() {
        const hash = window.location.hash;
        if (!hash || !hash.includes('access_token')) {
            return { success: false, error: 'No access token in callback' };
        }
        
        try {
            // Parse hash parameters
            const params = new URLSearchParams(hash.substring(1));
            const accessToken = params.get('access_token');
            const expiresIn = params.get('expires_in');
            const state = params.get('state');
            
            // Verify state (CSRF protection)
            const storedState = sessionStorage.getItem('oauth_state');
            if (state !== storedState) {
                throw new Error('State mismatch - possible CSRF attack');
            }
            
            if (!accessToken) {
                throw new Error('No access token received');
            }
            
            // Store token
            this.accessToken = accessToken;
            this.storeToken(accessToken, expiresIn);
            
            // Clean up
            sessionStorage.removeItem('oauth_state');
            
            console.log('OAuth successful, token stored');
            
            return { success: true, expiresIn: parseInt(expiresIn) };
        } catch (error) {
            console.error('OAuth callback error:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Store access token
    storeToken(accessToken, expiresIn) {
        const tokenData = {
            access_token: accessToken,
            expires_in: parseInt(expiresIn) || 28800, // Default 8 hours
            stored_at: Date.now()
        };
        
        sessionStorage.setItem('nav_token', JSON.stringify(tokenData));
    }
    
    // Load token from storage
    loadToken() {
        const stored = sessionStorage.getItem('nav_token');
        if (!stored) return false;
        
        try {
            const tokenData = JSON.parse(stored);
            const expiresAt = tokenData.stored_at + (tokenData.expires_in * 1000);
            
            // Check if token is expired
            if (Date.now() >= expiresAt) {
                console.log('Token expired');
                this.disconnect();
                return false;
            }
            
            this.accessToken = tokenData.access_token;
            return true;
        } catch (error) {
            console.error('Error loading token:', error);
            return false;
        }
    }
    
    // Check if authenticated
    isAuthenticated() {
        if (this.accessToken) return true;
        return this.loadToken();
    }
    
    // Get user info and account ID
    async getUserInfo() {
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }
        
        const response = await fetch('https://account-d.docusign.com/oauth/userinfo', {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to get user info');
        }
        
        const userInfo = await response.json();
        this.accountId = userInfo.accounts[0].account_id;
        return userInfo;
    }
    
    // Generate random string
    generateRandomString(length) {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const values = new Uint8Array(length);
        crypto.getRandomValues(values);
        return Array.from(values).map(v => charset[v % charset.length]).join('');
    }
    
    /**
     * Agreement Retrieval
     */
    
    async getAllAgreements() {
        if (!this.isAuthenticated()) {
            throw new Error('Not authenticated');
        }
        
        try {
            // Get account ID if we don't have it yet
            if (!this.accountId) {
                console.log('Getting account ID...');
                await this.getUserInfo();
            }
            
            console.log('Attempting to fetch agreements from Navigator API...');
            console.log('API URL:', `${this.navigatorURL}/accounts/${this.accountId}/agreements`);
            console.log('Account ID:', this.accountId);
            console.log('Access Token:', this.accessToken ? 'Present' : 'Missing');
            
            // Try to fetch from Navigator API with correct endpoint
            const response = await fetch(`${this.navigatorURL}/accounts/${this.accountId}/agreements`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('Navigator API Response Status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.warn(`Navigator API error: ${response.status} ${response.statusText}`, errorText);
                console.log('Falling back to sample data...');
                return this.getSampleAgreements();
            }
            
            const data = await response.json();
            console.log('Navigator API returned data:', data);
            
            // Navigator API returns agreements array directly or in a wrapper
            const agreementsList = data.agreements || data.items || data;
            
            if (!Array.isArray(agreementsList) || agreementsList.length === 0) {
                console.log('No agreements found in Navigator, using sample data');
                return this.getSampleAgreements();
            }
            
            console.log(`Successfully retrieved ${agreementsList.length} agreements from Navigator`);
            console.log('Fetching full details for each agreement...');
            
            // Fetch full details for each agreement
            const detailedAgreements = await this.fetchAgreementDetails(agreementsList);
            
            return this.processAgreements(detailedAgreements);
            
        } catch (error) {
            console.error('Get agreements error:', error);
            console.log('Falling back to sample data...');
            // Fallback to sample data
            return this.getSampleAgreements();
        }
    }
    
    // Fetch full details for each agreement
    async fetchAgreementDetails(agreementsList) {
        const detailedAgreements = [];
        
        for (let i = 0; i < agreementsList.length; i++) {
            const basicAgreement = agreementsList[i];
            const agreementId = basicAgreement.id || basicAgreement.agreementId;
            
            if (!agreementId) {
                console.warn('Agreement missing ID, skipping:', basicAgreement);
                continue;
            }
            
            try {
                console.log(`Fetching details for agreement ${i + 1}/${agreementsList.length}: ${agreementId}`);
                
                const response = await fetch(
                    `${this.navigatorURL}/accounts/${this.accountId}/agreements/${agreementId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                if (response.ok) {
                    const detailedAgreement = await response.json();
                    console.log(`Got details for ${agreementId}:`, detailedAgreement);
                    detailedAgreements.push(detailedAgreement);
                } else {
                    console.warn(`Failed to get details for ${agreementId}, status: ${response.status}`);
                    // Use basic agreement data as fallback
                    detailedAgreements.push(basicAgreement);
                }
                
                // Add small delay to avoid rate limiting (50ms between requests)
                await this.sleep(50);
                
            } catch (error) {
                console.error(`Error fetching agreement ${agreementId}:`, error);
                // Use basic agreement data as fallback
                detailedAgreements.push(basicAgreement);
            }
        }
        
        return detailedAgreements;
    }
    
    // Helper to add delay
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // Sample agreements for demo
    getSampleAgreements() {
        const sampleData = [
            {
                id: "AGR-001",
                navigatorId: "nav_001",
                navigatorUrl: "https://navigator-d.docusign.com/agreements/nav_001",
                title: "[SAMPLE] Germany & Austria - Imaging Systems",
                executionDate: "2024-01-15",
                effectiveDate: "2024-02-01",
                expirationDate: "2027-01-31",
                status: "Active",
                distributorLegalName: "MedizinTechnik Deutschland GmbH [SAMPLE]",
                lineOfBusiness: "Medical Imaging",
                initialTermLength: "3 years",
                territoryCountries: ["Germany", "Austria"],
                productCategories: ["MRI Systems", "CT Scanners", "Ultrasound Systems"],
                exclusivityStatus: "Exclusive",
                performanceBasedExclusivity: "Yes",
                customerSegmentRestrictions: "All healthcare facilities",
                commitmentCurrency: "EUR",
                discountMRI_CT: 38,
                discountUltrasound: 42,
                discountPatientMonitoring: null,
                softwareRevenueShare: 40,
                priceCapIncrease: 3,
                annualMinimums: [
                    {year: 2024, amount: 2000000},
                    {year: 2025, amount: 2500000},
                    {year: 2026, amount: 3000000}
                ],
                minimumPerformanceThreshold: 85,
                currentPerformance: 92,
                nonRenewalNoticeDays: 90,
                departmentsImpacted: "Legal; Sales; Finance"
            },
            {
                id: "AGR-002",
                navigatorId: "nav_002",
                navigatorUrl: "https://navigator-d.docusign.com/agreements/nav_002",
                title: "[SAMPLE] UK & Ireland - Patient Monitoring",
                executionDate: "2023-06-10",
                effectiveDate: "2023-07-01",
                expirationDate: "2025-06-30",
                status: "Active",
                distributorLegalName: "BritMed Solutions Ltd. [SAMPLE]",
                lineOfBusiness: "Patient Monitoring",
                initialTermLength: "2 years",
                territoryCountries: ["United Kingdom", "Ireland"],
                productCategories: ["Patient Monitoring Systems", "AI Software"],
                exclusivityStatus: "Conditional Exclusive",
                performanceBasedExclusivity: "Yes",
                customerSegmentRestrictions: "Hospitals and clinics only",
                commitmentCurrency: "GBP",
                discountMRI_CT: null,
                discountUltrasound: null,
                discountPatientMonitoring: 35,
                softwareRevenueShare: 45,
                priceCapIncrease: 2.5,
                annualMinimums: [
                    {year: 2023, amount: 800000},
                    {year: 2024, amount: 1000000},
                    {year: 2025, amount: 1200000}
                ],
                minimumPerformanceThreshold: 85,
                currentPerformance: 78,
                nonRenewalNoticeDays: 90,
                departmentsImpacted: "Legal; Sales"
            },
            {
                id: "AGR-003",
                navigatorId: "nav_003",
                navigatorUrl: "https://navigator-d.docusign.com/agreements/nav_003",
                title: "[SAMPLE] Japan - Advanced Imaging & AI",
                executionDate: "2024-09-20",
                effectiveDate: "2024-10-01",
                expirationDate: "2028-09-30",
                status: "Active",
                distributorLegalName: "NipponMed Technologies K.K. [SAMPLE]",
                lineOfBusiness: "Medical Imaging",
                initialTermLength: "4 years",
                territoryCountries: ["Japan"],
                productCategories: ["MRI Systems", "CT Scanners", "AI Software"],
                exclusivityStatus: "Exclusive",
                performanceBasedExclusivity: "No",
                customerSegmentRestrictions: "All healthcare facilities",
                commitmentCurrency: "JPY",
                discountMRI_CT: 40,
                discountUltrasound: 38,
                discountPatientMonitoring: null,
                softwareRevenueShare: 35,
                priceCapIncrease: 4,
                annualMinimums: [
                    {year: 2024, amount: 500000000},
                    {year: 2025, amount: 600000000},
                    {year: 2026, amount: 700000000},
                    {year: 2027, amount: 800000000}
                ],
                minimumPerformanceThreshold: 90,
                currentPerformance: 95,
                nonRenewalNoticeDays: 120,
                departmentsImpacted: "Legal; Sales; Finance; R&D"
            },
            {
                id: "AGR-004",
                navigatorId: "nav_004",
                navigatorUrl: "https://navigator-d.docusign.com/agreements/nav_004",
                title: "[SAMPLE] Brazil - Ultrasound Systems",
                executionDate: "2023-03-05",
                effectiveDate: "2023-04-01",
                expirationDate: "2025-03-31",
                status: "Active",
                distributorLegalName: "MedSul Distribuidora Ltda. [SAMPLE]",
                lineOfBusiness: "Medical Imaging",
                initialTermLength: "2 years",
                territoryCountries: ["Brazil"],
                productCategories: ["Ultrasound Systems"],
                exclusivityStatus: "Non-Exclusive",
                performanceBasedExclusivity: "No",
                customerSegmentRestrictions: "Private healthcare only",
                commitmentCurrency: "BRL",
                discountMRI_CT: null,
                discountUltrasound: 45,
                discountPatientMonitoring: null,
                softwareRevenueShare: null,
                priceCapIncrease: 5,
                annualMinimums: [
                    {year: 2023, amount: 3000000},
                    {year: 2024, amount: 3500000},
                    {year: 2025, amount: 4000000}
                ],
                minimumPerformanceThreshold: 80,
                currentPerformance: 65,
                nonRenewalNoticeDays: 60,
                departmentsImpacted: "Sales; Finance"
            },
            {
                id: "AGR-005",
                navigatorId: "nav_005",
                navigatorUrl: "https://navigator-d.docusign.com/agreements/nav_005",
                title: "[SAMPLE] Australia & New Zealand - Full Portfolio",
                executionDate: "2024-11-12",
                effectiveDate: "2024-12-01",
                expirationDate: "2027-11-30",
                status: "Active",
                distributorLegalName: "AusMed Healthcare Solutions Pty Ltd [SAMPLE]",
                lineOfBusiness: "Medical Equipment",
                initialTermLength: "3 years",
                territoryCountries: ["Australia", "New Zealand"],
                productCategories: ["MRI Systems", "CT Scanners", "Ultrasound Systems", "Patient Monitoring Systems", "AI Software"],
                exclusivityStatus: "Exclusive",
                performanceBasedExclusivity: "Yes",
                customerSegmentRestrictions: "All healthcare facilities",
                commitmentCurrency: "AUD",
                discountMRI_CT: 36,
                discountUltrasound: 40,
                discountPatientMonitoring: 38,
                softwareRevenueShare: 42,
                priceCapIncrease: 3.5,
                annualMinimums: [
                    {year: 2024, amount: 3000000},
                    {year: 2025, amount: 4000000},
                    {year: 2026, amount: 5000000}
                ],
                minimumPerformanceThreshold: 85,
                currentPerformance: 88,
                nonRenewalNoticeDays: 90,
                departmentsImpacted: "Legal; Sales; Finance; Operations"
            }
        ];
        
        return sampleData.map(agreement => this.calculateDerivedFields(agreement));
    }
    
    // Process agreements from Navigator API
    processAgreements(agreements) {
        console.log('Processing agreements from Navigator API:', agreements);
        return agreements.map(agreement => this.processAgreement(agreement));
    }
    
    // Process single agreement from Navigator API
    processAgreement(agreement) {
        console.log('Processing individual agreement:', agreement);
        
        const customFields = agreement.customFields || {};
        
        const processed = {
            id: agreement.id || agreement.agreementId || `agr-${Date.now()}`,
            navigatorId: agreement.id,
            navigatorUrl: agreement.documentUrl || agreement.viewUrl || agreement.url,
            
            // Core fields
            title: customFields.agreementTitle || customFields.title || agreement.name || 'Untitled Agreement',
            executionDate: customFields.executionDate || agreement.executionDate || agreement.createdDate,
            effectiveDate: customFields.effectiveDate || agreement.effectiveDate || agreement.executionDate,
            expirationDate: customFields.expirationDate || agreement.expirationDate || this.calculateExpirationDate(agreement),
            status: agreement.status || 'Active',
            
            // Distributor info
            distributorLegalName: customFields.distributorLegalName || customFields.distributorName || 'Unknown Distributor',
            lineOfBusiness: customFields.lineOfBusiness || customFields.businessLine || '',
            initialTermLength: customFields.initialTermLength || customFields.termLength || '',
            
            // Territory & Products
            territoryCountries: this.parseMultiValue(customFields.territoryCountries || customFields.territories || customFields.territory),
            productCategories: this.parseMultiValue(customFields.productCategories || customFields.products || customFields.product),
            customerSegmentRestrictions: customFields.customerSegmentRestrictions || customFields.customerSegments || '',
            
            // Exclusivity
            exclusivityStatus: customFields.exclusivityStatus || customFields.exclusivity || 'Non-Exclusive',
            performanceBasedExclusivity: customFields.performanceBasedExclusivity || 'No',
            exclusivityConversionTrigger: customFields.exclusivityConversionTrigger || '',
            
            // Financial terms
            commitmentCurrency: customFields.commitmentCurrency || customFields.currency || 'USD',
            discountMRI_CT: this.parseNumber(customFields.discountMRI_CT || customFields['discount-mri-ct']),
            discountUltrasound: this.parseNumber(customFields.discountUltrasound || customFields['discount-ultrasound']),
            discountPatientMonitoring: this.parseNumber(customFields.discountPatientMonitoring || customFields['discount-patient-monitoring']),
            softwareRevenueShare: this.parseNumber(customFields.softwareRevenueShare || customFields.softwareShare),
            priceCapIncrease: this.parseNumber(customFields.priceCapIncrease || customFields.priceCap),
            
            // Annual minimums
            annualMinimums: this.parseAnnualMinimums(customFields.annualMinimums || customFields.minimums),
            
            // Performance
            minimumPerformanceThreshold: this.parseNumber(customFields.minimumPerformanceThreshold || customFields.performanceThreshold) || 85,
            currentPerformance: this.parseNumber(customFields.currentPerformance || customFields.performance) || 0,
            
            // Renewal terms
            nonRenewalNoticeDays: this.parseNumber(customFields.nonRenewalNoticeDays || customFields.noticeDays) || 90,
            
            // Metadata
            departmentsImpacted: customFields.departmentsImpacted || customFields.departments || ''
        };
        
        return this.calculateDerivedFields(processed);
    }
    
    // Helper to calculate expiration date if not provided
    calculateExpirationDate(agreement) {
        // If we have effective date and term length, calculate
        if (agreement.effectiveDate && agreement.termLength) {
            const effective = new Date(agreement.effectiveDate);
            const years = parseInt(agreement.termLength) || 1;
            effective.setFullYear(effective.getFullYear() + years);
            return effective.toISOString().split('T')[0];
        }
        // Default to 1 year from now
        const future = new Date();
        future.setFullYear(future.getFullYear() + 1);
        return future.toISOString().split('T')[0];
    }
    
    // Parse multi-value fields
    parseMultiValue(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string' && value) {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : [value];
            } catch {
                return value.split(/[,;|]/).map(v => v.trim()).filter(Boolean);
            }
        }
        return [];
    }
    
    // Parse number fields
    parseNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
    }
    
    // Parse annual minimums
    parseAnnualMinimums(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string' && value) {
            try {
                return JSON.parse(value);
            } catch {
                return [];
            }
        }
        return [];
    }
    
    calculateDerivedFields(agreement) {
        const now = new Date();
        const expirationDate = new Date(agreement.expirationDate);
        
        const nonRenewalDeadline = new Date(expirationDate);
        nonRenewalDeadline.setDate(nonRenewalDeadline.getDate() - agreement.nonRenewalNoticeDays);
        agreement.nonRenewalDeadline = nonRenewalDeadline.toISOString().split('T')[0];
        
        agreement.daysUntilExpiration = Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));
        agreement.daysUntilDeadline = Math.ceil((nonRenewalDeadline - now) / (1000 * 60 * 60 * 24));
        
        if (agreement.daysUntilDeadline <= 30 && agreement.daysUntilDeadline > 0) {
            agreement.renewalUrgency = 'Urgent';
        } else if (agreement.daysUntilDeadline <= 90 && agreement.daysUntilDeadline > 0) {
            agreement.renewalUrgency = 'Warning';
        } else {
            agreement.renewalUrgency = 'On Track';
        }
        
        const currentYear = now.getFullYear();
        const yearCommitment = agreement.annualMinimums.find(m => m.year === currentYear);
        agreement.currentYearCommitment = yearCommitment?.amount || 0;
        
        agreement.aiRiskScore = this.calculateRiskScore(agreement);
        agreement.lastSyncedFromNavigator = new Date().toISOString();
        
        return agreement;
    }
    
    calculateRiskScore(agreement) {
        let riskPoints = 0;
        
        if (agreement.currentPerformance < agreement.minimumPerformanceThreshold) {
            riskPoints += 3;
        } else if (agreement.currentPerformance < (agreement.minimumPerformanceThreshold + 5)) {
            riskPoints += 1;
        }
        
        if (agreement.daysUntilDeadline <= 30 && agreement.daysUntilDeadline > 0) {
            riskPoints += 3;
        } else if (agreement.daysUntilDeadline <= 90 && agreement.daysUntilDeadline > 0) {
            riskPoints += 1;
        }
        
        if (agreement.exclusivityStatus === 'Conditional Exclusive' && agreement.currentPerformance < 90) {
            riskPoints += 2;
        }
        
        if (riskPoints >= 5) return 'High';
        if (riskPoints >= 2) return 'Medium';
        return 'Low';
    }
    
    /**
     * Sync functionality
     */
    
    async syncAgreements(progressCallback) {
        const startTime = Date.now();
        
        try {
            if (progressCallback) progressCallback({ stage: 'authenticating', progress: 0 });
            
            if (!this.isAuthenticated()) {
                throw new Error('Not authenticated');
            }
            
            if (progressCallback) progressCallback({ stage: 'fetching', progress: 20 });
            
            const agreements = await this.getAllAgreements();
            
            if (progressCallback) progressCallback({ stage: 'processing', progress: 60 });
            
            const conflicts = this.detectConflicts(agreements);
            
            if (progressCallback) progressCallback({ stage: 'caching', progress: 80 });
            
            this.cache.set('agreements', agreements);
            this.cache.set('conflicts', conflicts);
            this.lastSyncTime = new Date().toISOString();
            
            localStorage.setItem('nav_agreements', JSON.stringify(agreements));
            localStorage.setItem('nav_conflicts', JSON.stringify(conflicts));
            localStorage.setItem('nav_last_sync', this.lastSyncTime);
            
            if (progressCallback) progressCallback({ stage: 'complete', progress: 100 });
            
            const syncTime = (Date.now() - startTime) / 1000;
            
            return {
                success: true,
                count: agreements.length,
                conflicts: conflicts.length,
                syncTime: syncTime,
                lastSyncTime: this.lastSyncTime
            };
        } catch (error) {
            console.error('Sync error:', error);
            
            if (progressCallback) progressCallback({ stage: 'error', progress: 0, error: error.message });
            
            return {
                success: false,
                error: error.message,
                usingCache: this.loadFromCache()
            };
        }
    }
    
    detectConflicts(agreements) {
        const conflicts = [];
        
        for (let i = 0; i < agreements.length; i++) {
            for (let j = i + 1; j < agreements.length; j++) {
                const a = agreements[i];
                const b = agreements[j];
                
                const territoryOverlap = a.territoryCountries.some(t => b.territoryCountries.includes(t));
                if (!territoryOverlap) continue;
                
                const productOverlap = a.productCategories.some(p => b.productCategories.includes(p));
                if (!productOverlap) continue;
                
                const hasConflict = 
                    (a.exclusivityStatus === 'Exclusive' && b.exclusivityStatus === 'Exclusive') ||
                    (a.exclusivityStatus === 'Exclusive' && b.exclusivityStatus !== 'Exclusive') ||
                    (b.exclusivityStatus === 'Exclusive' && a.exclusivityStatus !== 'Exclusive');
                
                if (hasConflict) {
                    conflicts.push({
                        type: 'Territory/Product Conflict',
                        severity: a.exclusivityStatus === 'Exclusive' && b.exclusivityStatus === 'Exclusive' ? 'High' : 'Medium',
                        agreement1: { id: a.id, title: a.title, exclusivity: a.exclusivityStatus },
                        agreement2: { id: b.id, title: b.title, exclusivity: b.exclusivityStatus },
                        overlappingTerritories: a.territoryCountries.filter(t => b.territoryCountries.includes(t)),
                        overlappingProducts: a.productCategories.filter(p => b.productCategories.includes(p))
                    });
                }
            }
        }
        
        return conflicts;
    }
    
    loadFromCache() {
        const cached = localStorage.getItem('nav_agreements');
        if (cached) {
            const agreements = JSON.parse(cached);
            this.cache.set('agreements', agreements);
            this.lastSyncTime = localStorage.getItem('nav_last_sync');
            return true;
        }
        return false;
    }
    
    getCachedAgreements() {
        return this.cache.get('agreements') || JSON.parse(localStorage.getItem('nav_agreements') || '[]');
    }
    
    getCachedConflicts() {
        return this.cache.get('conflicts') || JSON.parse(localStorage.getItem('nav_conflicts') || '[]');
    }
    
    getLastSyncTime() {
        return this.lastSyncTime || localStorage.getItem('nav_last_sync');
    }
    
    disconnect() {
        this.accessToken = null;
        this.accountId = null;
        this.cache.clear();
        this.lastSyncTime = null;
        
        sessionStorage.removeItem('nav_token');
        sessionStorage.removeItem('oauth_state');
        localStorage.removeItem('nav_agreements');
        localStorage.removeItem('nav_conflicts');
        localStorage.removeItem('nav_last_sync');
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.NavigatorAPIServiceImplicit = NavigatorAPIServiceImplicit;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigatorAPIServiceImplicit;
}
