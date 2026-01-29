/**
 * DocuSign Navigator API Service - PKCE Version
 * Optimized for GitHub Pages and static hosting (no client secret required)
 */

class NavigatorAPIServicePKCE {
    constructor() {
        this.baseURL = 'https://demo.docusign.net/restapi/v2.1';
        this.navigatorURL = 'https://navigator-d.docusign.com/api/v1';  // Demo Navigator
        this.accessToken = null;
        this.refreshToken = null;
        this.accountId = null;
        this.tokenExpiry = null;
        this.cache = new Map();
        this.lastSyncTime = null;
    }

    /**
     * PKCE Helper Functions
     */
    
    // Generate random string for code verifier
    generateRandomString(length) {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        const values = new Uint8Array(length);
        crypto.getRandomValues(values);
        return Array.from(values).map(v => charset[v % charset.length]).join('');
    }
    
    // Generate code challenge from verifier using SHA-256
    async generateCodeChallenge(verifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const hash = await crypto.subtle.digest('SHA-256', data);
        
        // Convert hash to base64url
        const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
        return base64
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }
    
    /**
     * OAuth 2.0 with PKCE Flow
     */
    
    // Initialize OAuth 2.0 PKCE flow
    async initiateOAuthPKCE(clientId, redirectUri) {
        // Generate code verifier (43-128 characters)
        const codeVerifier = this.generateRandomString(128);
        
        // Generate code challenge
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);
        
        // Store code verifier for later (it's safe to store this)
        sessionStorage.setItem('pkce_code_verifier', codeVerifier);
        
        // Generate state for CSRF protection
        const state = this.generateRandomString(32);
        sessionStorage.setItem('oauth_state', state);
        
        const authURL = 'https://account-d.docusign.com/oauth/auth';
        const params = new URLSearchParams({
            response_type: 'code',
            scope: 'signature navigator_read',
            client_id: clientId,
            redirect_uri: redirectUri,
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        });
        
        window.location.href = `${authURL}?${params.toString()}`;
    }
    
    // Exchange authorization code for tokens (PKCE - no client secret!)
    async exchangeCodeForTokenPKCE(code, clientId, redirectUri) {
        try {
            // Retrieve the code verifier we stored earlier
            const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
            if (!codeVerifier) {
                throw new Error('Code verifier not found. Please restart the OAuth flow.');
            }
            
            const response = await fetch('https://account-d.docusign.com/oauth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirectUri,
                    client_id: clientId,
                    code_verifier: codeVerifier  // PKCE verification
                })
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`OAuth token exchange failed: ${error}`);
            }
            
            const data = await response.json();
            this.setTokens(data);
            
            // Clean up stored verifier
            sessionStorage.removeItem('pkce_code_verifier');
            sessionStorage.removeItem('oauth_state');
            
            // Get user info to retrieve account ID
            await this.getUserInfo();
            
            return {
                success: true,
                expiresIn: data.expires_in
            };
        } catch (error) {
            console.error('Token exchange error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Refresh access token (PKCE - no client secret!)
    async refreshAccessTokenPKCE(clientId) {
        try {
            const response = await fetch('https://account-d.docusign.com/oauth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: this.refreshToken,
                    client_id: clientId
                })
            });
            
            if (!response.ok) {
                throw new Error('Token refresh failed');
            }
            
            const data = await response.json();
            this.setTokens(data);
            
            return { success: true };
        } catch (error) {
            console.error('Token refresh error:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Set tokens and expiry
    setTokens(tokenData) {
        this.accessToken = tokenData.access_token;
        this.refreshToken = tokenData.refresh_token;
        this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000);
        
        // Store tokens (safe for client-side with PKCE)
        this.storeTokensSecurely(tokenData);
    }
    
    // Store tokens securely in sessionStorage
    storeTokensSecurely(tokenData) {
        // For PKCE flow, storing in sessionStorage is acceptable
        // Tokens are short-lived and scoped to user's browser
        const tokenInfo = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            token_type: tokenData.token_type,
            stored_at: Date.now()
        };
        sessionStorage.setItem('nav_tokens', JSON.stringify(tokenInfo));
    }
    
    // Load tokens from storage
    loadTokens() {
        const stored = sessionStorage.getItem('nav_tokens');
        if (stored) {
            const tokens = JSON.parse(stored);
            this.accessToken = tokens.access_token;
            this.refreshToken = tokens.refresh_token;
            this.tokenExpiry = tokens.stored_at + (tokens.expires_in * 1000);
            return true;
        }
        return false;
    }
    
    // Check if tokens need refresh
    async ensureValidToken(clientId) {
        if (!this.accessToken) {
            const loaded = this.loadTokens();
            if (!loaded) {
                throw new Error('No valid authentication. Please login.');
            }
        }
        
        // Refresh if token expires in less than 5 minutes
        if (this.tokenExpiry && (this.tokenExpiry - Date.now()) < 300000) {
            await this.refreshAccessTokenPKCE(clientId);
        }
    }
    
    // Get user info and account ID
    async getUserInfo() {
        const response = await fetch('https://account-d.docusign.com/oauth/userinfo', {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });
        
        const userInfo = await response.json();
        this.accountId = userInfo.accounts[0].account_id;
        return userInfo;
    }
    
    /**
     * Agreement Retrieval (same as standard version)
     */
    
    async getAllAgreements(clientId) {
        await this.ensureValidToken(clientId);
        
        try {
            const response = await fetch(`${this.navigatorURL}/agreements`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Navigator API error: ${response.statusText}`);
            }
            
            const data = await response.json();
            return this.processAgreements(data.agreements || []);
        } catch (error) {
            console.error('Get agreements error:', error);
            throw error;
        }
    }
    
    async getAgreement(agreementId, clientId) {
        await this.ensureValidToken(clientId);
        
        try {
            const response = await fetch(`${this.navigatorURL}/agreements/${agreementId}`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Navigator API error: ${response.statusText}`);
            }
            
            const agreement = await response.json();
            return this.processAgreement(agreement);
        } catch (error) {
            console.error('Get agreement error:', error);
            throw error;
        }
    }
    
    processAgreements(agreements) {
        return agreements.map(agreement => this.processAgreement(agreement));
    }
    
    processAgreement(agreement) {
        const customFields = agreement.customFields || {};
        
        const processed = {
            id: agreement.id || agreement.agreementId,
            navigatorId: agreement.id,
            navigatorUrl: agreement.documentUrl || agreement.viewUrl,
            
            title: customFields.title || agreement.name,
            executionDate: customFields.executionDate || agreement.executionDate,
            effectiveDate: customFields.effectiveDate || agreement.effectiveDate,
            expirationDate: customFields.expirationDate || agreement.expirationDate,
            status: agreement.status || 'Active',
            
            distributorLegalName: customFields.distributorLegalName || '',
            lineOfBusiness: customFields.lineOfBusiness || '',
            initialTermLength: customFields.initialTermLength || '',
            
            territoryCountries: this.parseMultiValue(customFields.territoryCountries),
            productCategories: this.parseMultiValue(customFields.productCategories),
            customerSegmentRestrictions: customFields.customerSegmentRestrictions || '',
            
            exclusivityStatus: customFields.exclusivityStatus || 'Non-Exclusive',
            performanceBasedExclusivity: customFields.performanceBasedExclusivity || 'No',
            exclusivityConversionTrigger: customFields.exclusivityConversionTrigger || '',
            
            commitmentCurrency: customFields.commitmentCurrency || 'USD',
            discountMRI_CT: this.parseNumber(customFields.discountMRI_CT),
            discountUltrasound: this.parseNumber(customFields.discountUltrasound),
            discountPatientMonitoring: this.parseNumber(customFields.discountPatientMonitoring),
            softwareRevenueShare: this.parseNumber(customFields.softwareRevenueShare),
            priceCapIncrease: this.parseNumber(customFields.priceCapIncrease),
            
            annualMinimums: this.parseAnnualMinimums(customFields.annualMinimums),
            
            minimumPerformanceThreshold: this.parseNumber(customFields.minimumPerformanceThreshold) || 85,
            currentPerformance: this.parseNumber(customFields.currentPerformance) || 0,
            
            nonRenewalNoticeDays: this.parseNumber(customFields.nonRenewalNoticeDays) || 90,
            
            departmentsImpacted: customFields.departmentsImpacted || '',
            lastSyncedFromNavigator: new Date().toISOString()
        };
        
        return this.calculateDerivedFields(processed);
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
        
        if (agreement.exclusivityStatus === 'Conditional Exclusive' && 
            agreement.currentPerformance < 90) {
            riskPoints += 2;
        }
        
        if (riskPoints >= 5) return 'High';
        if (riskPoints >= 2) return 'Medium';
        return 'Low';
    }
    
    async syncAgreements(clientId, progressCallback) {
        const startTime = Date.now();
        
        try {
            if (progressCallback) progressCallback({ stage: 'authenticating', progress: 0 });
            
            await this.ensureValidToken(clientId);
            
            if (progressCallback) progressCallback({ stage: 'fetching', progress: 20 });
            
            const agreements = await this.getAllAgreements(clientId);
            
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
                
                const territoryOverlap = a.territoryCountries.some(t => 
                    b.territoryCountries.includes(t)
                );
                
                if (!territoryOverlap) continue;
                
                const productOverlap = a.productCategories.some(p => 
                    b.productCategories.includes(p)
                );
                
                if (!productOverlap) continue;
                
                const hasConflict = 
                    (a.exclusivityStatus === 'Exclusive' && b.exclusivityStatus === 'Exclusive') ||
                    (a.exclusivityStatus === 'Exclusive' && b.exclusivityStatus !== 'Exclusive') ||
                    (b.exclusivityStatus === 'Exclusive' && a.exclusivityStatus !== 'Exclusive');
                
                if (hasConflict) {
                    conflicts.push({
                        type: 'Territory/Product Conflict',
                        severity: a.exclusivityStatus === 'Exclusive' && b.exclusivityStatus === 'Exclusive' ? 'High' : 'Medium',
                        agreement1: {
                            id: a.id,
                            title: a.title,
                            exclusivity: a.exclusivityStatus
                        },
                        agreement2: {
                            id: b.id,
                            title: b.title,
                            exclusivity: b.exclusivityStatus
                        },
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
        this.refreshToken = null;
        this.accountId = null;
        this.tokenExpiry = null;
        this.cache.clear();
        this.lastSyncTime = null;
        
        sessionStorage.removeItem('nav_tokens');
        sessionStorage.removeItem('pkce_code_verifier');
        sessionStorage.removeItem('oauth_state');
        localStorage.removeItem('nav_agreements');
        localStorage.removeItem('nav_conflicts');
        localStorage.removeItem('nav_last_sync');
    }
    
    parseMultiValue(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : [value];
            } catch {
                return value.split(/[,;]/).map(v => v.trim()).filter(Boolean);
            }
        }
        return [];
    }
    
    parseNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
    }
    
    parseAnnualMinimums(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                return [];
            }
        }
        return [];
    }
}

// Export for use in browser
if (typeof window !== 'undefined') {
    window.NavigatorAPIServicePKCE = NavigatorAPIServicePKCE;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigatorAPIServicePKCE;
}
