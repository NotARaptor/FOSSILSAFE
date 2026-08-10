import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useDemoMode } from "@/lib/demoMode"
import { api } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import AddUserModal from "@/components/AddUserModal"
import CatalogExportModal from "@/components/maintenance/CatalogExportModal"
import AddSourceModal from "@/components/AddSourceModal"
import ConfirmationModal from "@/components/ui/ConfirmationModal"
import DiagnosticsHistory from "@/components/DiagnosticsHistory"
import { Loader2 } from "lucide-react"
import WebhooksPanel from "@/components/WebhooksPanel"

const TABS = ['General', 'Sources', 'Users', 'SSO/OIDC', 'Automation', 'Notifications', 'Audit Log', 'Diagnostics', 'Maintenance'];



export default function SettingsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');

    // Validate if the tab from URL exists in TABS, otherwise default to first tab
    const initialTab = TABS.includes(tabParam as any) ? tabParam! : 'General';
    const [activeTab, setActiveTab] = useState(initialTab);

    // Sync activeTab state when searchParams.tab changes (e.g. forward/back buttons)
    useEffect(() => {
        if (tabParam && TABS.includes(tabParam as any) && tabParam !== activeTab) {
            setActiveTab(tabParam);
        }
    }, [tabParam]);

    // Function to update activeTab and URL query param simultaneously
    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        setSearchParams({ tab });
    };

    const [showUserModal, setShowUserModal] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false)
    const [openUserMenu, setOpenUserMenu] = useState<number | null>(null)
        ;
    const [showSourceModal, setShowSourceModal] = useState(false);
    const { isDemoMode, toggleDemoMode } = useDemoMode();
    const { logout, user: currentUser } = useAuth();

    // System info state
    const [systemInfo, setSystemInfo] = useState<any>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [auditLoading, setAuditLoading] = useState(false);
    const [tapes, setTapes] = useState<any[]>([]);

    // Sources state
    const [sources, setSources] = useState<any[]>([]);
    const [sourcesLoading, setSourcesLoading] = useState(false);

    // SSO state
    const [ssoIssuer, setSsoIssuer] = useState('');
    const [ssoClientId, setSsoClientId] = useState('');
    const [ssoClientSecret, setSsoClientSecret] = useState('');
    const [ssoEnabled, setSsoEnabled] = useState(false);
    const [ssoLoading, setSsoLoading] = useState(false);
    const [ssoError, setSsoError] = useState('');
    const [ssoSuccess, setSsoSuccess] = useState('');

    // Notifications state
    const [notificationConfig, setNotificationConfig] = useState<any>({
        smtp: { enabled: false, host: '', port: 587, user: '', password: '', encryption: 'starttls' },
        webhook: { enabled: false, webhook_url: '', webhook_type: 'generic' },
        snmp: { enabled: false, target_host: '', port: 162, community: 'public' }
    });
    const [notifLoading, setNotifLoading] = useState(false);
    const [notifSuccess, setNotifSuccess] = useState('');
    const [notifError, setNotifError] = useState('');
    const [testingProvider, setTestingProvider] = useState<string | null>(null);

    // KMS & Streaming State
    const [kmsConfig, setKmsConfig] = useState<{
        type: 'local' | 'vault';
        vault_addr: string;
        mount_path: string;
        vault_token: string; // Only for input
        vault_token_configured: boolean;
    }>({ type: 'local', vault_addr: '', mount_path: 'secret', vault_token: '', vault_token_configured: false });
    const [kmsLoading, setKmsLoading] = useState(false);

    const [streamingConfig, setStreamingConfig] = useState<{
        enabled: boolean;
        max_queue_size_gb: number;
        max_queue_files: number;
        producer_threads: number;
    }>({ enabled: false, max_queue_size_gb: 10, max_queue_files: 1000, producer_threads: 2 });
    const [streamingLoading, setStreamingLoading] = useState(false);
    
    // Mail Slot State
    const [mailSlotConfig, setMailSlotConfig] = useState<{
        enabled: boolean;
        auto_detect: boolean;
        manual_index?: number;
    }>({ enabled: true, auto_detect: true });
    const [mailSlotLoading, setMailSlotLoading] = useState(false);

    // Diagnostics state
    const [diagnosticsHealth, setDiagnosticsHealth] = useState<any>(null);
    const [diagLoading, setDiagLoading] = useState(false);
    const [bundleLoading, setBundleLoading] = useState(false);
    const [bundleResult, setBundleResult] = useState<{ message: string; bundle_path: string } | null>(null);
    const [verifyingAudit, setVerifyingAudit] = useState(false);
    const [generatingReport, setGeneratingReport] = useState(false);
    const [verificationResult, setVerificationResult] = useState<{ valid: boolean; total_entries: number; verified_count?: number; first_invalid_id?: number; error?: string } | null>(null);
    const [auditVerificationHistory, setAuditVerificationHistory] = useState<any[]>([]);

    // Confirmation Modal state
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        variant: 'danger' | 'info' | 'warning';
        confirmText?: string;
    }>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
        variant: 'info'
    });
    const [syncLoading, setSyncLoading] = useState(false);

    useEffect(() => {
    }, []);

    useEffect(() => {
        if (activeTab === 'General') {
            fetchSystemInfo();
            fetchMailSlotConfig();
        } else if (activeTab === 'Users') {
            fetchUsers();
        } else if (activeTab === 'Audit Log') {
            fetchAuditLogs();
            fetchAuditVerificationHistory();
        } else if (activeTab === 'Maintenance') {
            fetchTapes();
            fetchKMSConfig();
            fetchStreamingConfig();
        } else if (activeTab === 'SSO/OIDC') {
            fetchSSOConfig();
        } else if (activeTab === 'Sources') {
            fetchSources();
        } else if (activeTab === 'Notifications') {
            fetchNotificationSettings();
        } else if (activeTab === 'Diagnostics') {
            fetchDiagnosticsHealth();
        }
    }, [activeTab]);

    const fetchMailSlotConfig = async () => {
        if (isDemoMode) return;
        setMailSlotLoading(true);
        try {
            const res = await api.getMailSlotConfig();
            if (res.success && res.data) {
                setMailSlotConfig(res.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setMailSlotLoading(false);
        }
    };

    const handleUpdateMailSlotConfig = async (updates: any) => {
        const newConfig = { ...mailSlotConfig, ...updates };
        setMailSlotConfig(newConfig);
        try {
            const res = await api.updateMailSlotConfig(updates);
            if (!res.success) {
                alert('Failed to update mail slot config: ' + res.error);
                fetchMailSlotConfig(); // Revert
            } else {
                fetchSystemInfo(); // Update stats
            }
        } catch (e) {
            alert('Network error');
            fetchMailSlotConfig(); // Revert
        }
    };

    const fetchDiagnosticsHealth = async () => {
        setDiagLoading(true);
        try {
            const res = await api.getDiagnosticsHealth();
            if (res.success) {
                setDiagnosticsHealth(res.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setDiagLoading(false);
        }
    };

    const handleRunDiagnostics = async () => {
        try {
            const res = await api.runDiagnostics();
            if (res.success) {
                // Diagnostics run in background via job
                alert(`Diagnostics job started: ${res.data?.job_id}. You can track it in the Jobs page.`);
            } else {
                alert(`Failed to start diagnostics: ${res.error}`);
            }
        } catch (e) {
            alert(`Error: ${e}`);
        }
    };

    const handleGenerateBundle = async () => {
        setBundleLoading(true);
        setBundleResult(null);
        try {
            const res = await api.generateSupportBundle();
            if (res.success) {
                setBundleResult(res.data || null);
            } else {
                alert(`Failed to generate support bundle: ${res.error}`);
            }
        } catch (e) {
            alert(`Error: ${e}`);
        } finally {
            setBundleLoading(false);
        }
    };

    const fetchKMSConfig = async () => {
        if (isDemoMode) {
            setKmsConfig({ type: 'local', vault_addr: '', mount_path: 'secret', vault_token: '', vault_token_configured: false });
            return;
        }
        try {
            const res = await api.getKMSConfig();
            if (res.success && res.data) {
                setKmsConfig({ ...res.data, vault_token: '' });
            }
        } catch (e) { console.error(e); }
    };

    const fetchStreamingConfig = async () => {
        if (isDemoMode) {
            setStreamingConfig({ enabled: false, max_queue_size_gb: 10, max_queue_files: 1000, producer_threads: 2 });
            return;
        }
        try {
            const res = await api.getStreamingConfig();
            if (res.success && res.data) {
                setStreamingConfig(res.data);
            }
        } catch (e) { console.error(e); }
    };

    const handleKMSSave = async () => {
        setKmsLoading(true);
        try {
            const res = await api.updateKMSConfig(kmsConfig);
            if (res.success) {
                alert('KMS Configuration Saved');
                fetchKMSConfig();
            } else {
                alert('Error: ' + res.error);
            }
        } catch (e) { alert('Network Error'); }
        setKmsLoading(false);
    };

    const handleStreamingSave = async () => {
        setStreamingLoading(true);
        try {
            const res = await api.updateStreamingConfig(streamingConfig);
            if (res.success) {
                alert('Streaming Configuration Saved');
            } else {
                alert('Error: ' + res.error);
            }
        } catch (e) { alert('Network Error'); }
        setStreamingLoading(false);
    };

    const fetchSources = async () => {
        if (isDemoMode) {
            setSources([
                { id: 1, name: 'Production NAS', type: 'smb', config: { path: '//nas/production' }, created_at: new Date().toISOString() },
                { id: 2, name: 'Cloud Archive', type: 's3', config: { endpoint: 's3.us-east-1.amazonaws.com', bucket: 'fossil-archive' }, created_at: new Date().toISOString() }
            ]);
            return;
        }
        setSourcesLoading(true);
        try {
            const res = await api.getSources();
            if (res.success && res.data) {
                setSources(res.data.sources);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setSourcesLoading(false);
        }
    };

    const handleDeleteSource = (sourceId: number) => {
        setConfirmModal({
            isOpen: true,
            title: 'Delete Source',
            message: 'Are you sure you want to delete this source? This will remove the connection configuration. Any jobs using this source will fail until updated.',
            variant: 'danger',
            confirmText: 'Delete Source',
            onConfirm: async () => {
                if (isDemoMode) {
                    setSources(prev => prev.filter(s => s.id !== sourceId));
                    return;
                }

                const res = await api.deleteSource(sourceId);
                if (res.success) {
                    fetchSources();
                } else {
                    console.error('Failed to delete source: ' + (res.error || 'Unknown error'));
                }
            }
        });
    };

    const fetchSSOConfig = async () => {
        if (isDemoMode) {
            setSsoIssuer('https://auth.demo.com');
            setSsoClientId('demo-client');
            setSsoClientSecret('********');
            setSsoEnabled(false);
            return;
        }

        try {
            const res = await api.getSSOConfig();
            if (res.success && res.data) {
                setSsoIssuer(res.data.issuer || '');
                setSsoClientId(res.data.client_id || '');
                setSsoClientSecret(res.data.client_secret || '');
                setSsoEnabled(res.data.enabled || false);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleSSOSave = async () => {
        if (!ssoIssuer || !ssoClientId) {
            setSsoError('Issuer and Client ID are required');
            return;
        }

        setSsoLoading(true);
        setSsoError('');
        setSsoSuccess('');

        try {
            const res = await api.updateSSOConfig({
                issuer: ssoIssuer,
                client_id: ssoClientId,
                client_secret: ssoClientSecret,
                enabled: ssoEnabled
            });

            if (res.success) {
                setSsoSuccess('Configuration saved successfully');
            } else {
                setSsoError(res.error || 'Failed to save configuration');
            }
        } catch (err) {
            setSsoError('Network error');
        } finally {
            setSsoLoading(false);
        }
    };

    const fetchTapes = async () => {
        if (isDemoMode) {
            setTapes([]);
            return;
        }
        const res = await api.getTapes();
        if (res.success && res.data) {
            setTapes(res.data.tapes);
        }
    };


    const fetchSystemInfo = async () => {
        if (isDemoMode) {
            setSystemInfo({ version: 'v3.4.1-stable', hostname: 'DEMO-NODE', uptime: 3600, load_avg: [0.1, 0.2, 0.3], hardware_available: true });
            return;
        }
        const res = await api.getSystemInfo();
        if (res.success && res.data) {
            setSystemInfo(res.data);
        }
    };

    const fetchUsers = async () => {
        if (isDemoMode) {
            setUsers([
                { id: 1, username: 'admin', role: 'admin', is_active: true, has_2fa: true },
                { id: 2, username: 'operator1', role: 'operator', is_active: true, has_2fa: false }
            ]);
            return;
        }
        const res = await api.getUsers();
        if (res.success && res.data) {
            setUsers(res.data.users);
        }
    };

    const handleReset2FA = (userId: number, username: string) => {
        setConfirmModal({
            isOpen: true,
            title: 'Reset 2FA',
            message: `Are you sure you want to reset 2FA for user ${username}? They will need to set it up again on next login.`,
            variant: 'warning',
            onConfirm: async () => {
                if (isDemoMode) {
                    console.log('Demo Mode: 2FA reset for ' + username);
                    return;
                }

                const res = await api.disable2FA(userId);
                if (res.success) {
                    console.log('2FA has been disabled for ' + username);
                    fetchUsers();
                } else {
                    console.error('Failed to reset 2FA: ' + (res.error || 'Unknown error'));
                }
            }
        });
    };

    const handleDeleteUser = (userId: number, username: string) => {
        if (currentUser && userId === currentUser.id) {
            setConfirmModal({
                isOpen: true,
                title: 'Operation Denied',
                message: 'You cannot delete your own administrative account. Please use another admin account to perform this action if necessary.',
                variant: 'warning',
                onConfirm: () => { }
            });
            return;
        }

        setConfirmModal({
            isOpen: true,
            title: 'Delete User',
            message: `CRITICAL: Are you sure you want to PERMANENTLY DELETE user ${username}? This action cannot be undone.`,
            variant: 'danger',
            confirmText: 'Delete User',
            onConfirm: async () => {
                if (isDemoMode) {
                    alert('Demo Mode: User ' + username + ' deleted.');
                    setUsers(prev => prev.filter(u => u.id !== userId));
                    return;
                }

                const res = await api.deleteUser(userId);
                if (res.success) {
                    fetchUsers();
                } else {
                    console.error('Failed to delete user: ' + (res.error || 'Unknown error'));
                }
            }
        });
    };

    const fetchNotificationSettings = async () => {
        if (isDemoMode) {
            setNotificationConfig({
                smtp: { enabled: true, host: 'smtp.demo.com', port: 587, user: 'backup@demo.com', password: 'password', encryption: 'ssl' },
                webhook: { enabled: false, webhook_url: 'https://discord.com/api/webhooks/...', webhook_type: 'discord' },
                snmp: { enabled: false, target_host: '10.0.0.5', port: 162, community: 'fs-public' }
            });
            return;
        }

        setNotifLoading(true);
        try {
            const res = await api.getNotificationSettings();
            if (res.success && res.data?.settings) {
                setNotificationConfig(res.data.settings);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setNotifLoading(false);
        }
    };

    const handleNotifSave = async () => {
        setNotifLoading(true);
        setNotifError('');
        setNotifSuccess('');
        try {
            const res = await api.updateNotificationSettings(notificationConfig);
            if (res.success) {
                setNotifSuccess('Notification settings saved');
            } else {
                setNotifError(res.error || 'Failed to save settings');
            }
        } catch (err) {
            setNotifError('Network error');
        } finally {
            setNotifLoading(false);
        }
    };

    const handleTestNotif = async (provider: 'smtp' | 'webhook' | 'snmp') => {
        setTestingProvider(provider);
        try {
            const res = await api.testNotification(provider);
            if (res.success) {
                alert(`Test for ${provider} successful: ${res.data?.message}`);
            } else {
                alert(`Test for ${provider} failed: ${res.error}`);
            }
        } catch (err) {
            alert('Test failed: Network error');
        } finally {
            setTestingProvider(null);
        }
    };

    const handleGenerateComplianceReport = async () => {
        setGeneratingReport(true);
        try {
            if (isDemoMode) {
                await new Promise(r => setTimeout(r, 2000));
                const mockReport = {
                    report_id: 'RPT-DEMO-' + Math.random().toString(36).substr(2, 6).toUpperCase(),
                    generated_at: new Date().toISOString(),
                    status: 'COMPLIANT',
                    compliance_stats: {
                        worm_locked_tapes: 4,
                        total_audit_entries: 1240,
                        security_events_summary: { login_failures: 12 }
                    },
                    signature: 'OFFLINE_DEMO_SIGNATURE_INVALID_FOR_PRODUCTION'
                };
                const blob = new Blob([JSON.stringify(mockReport, null, 4)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `fossil_safe_compliance_${new Date().toISOString().split('T')[0]}.json`;
                a.click();
            } else {
                const res = await api.getComplianceReport();
                if (res.success && res.data) {
                    const blob = new Blob([JSON.stringify(res.data, null, 4)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `fossil_safe_compliance_${new Date().toISOString().split('T')[0]}.json`;
                    a.click();
                } else {
                    alert('Failed to generate compliance report: ' + res.error);
                }
            }
        } catch (e: any) {
            alert('Error generating report: ' + e.message);
        } finally {
            setGeneratingReport(false);
        }
    };

    const handleVerifyAudit = async () => {
        setVerifyingAudit(true);
        setVerificationResult(null);
        try {
            if (isDemoMode) {
                await new Promise(r => setTimeout(r, 1500));
                setVerificationResult({ valid: true, total_entries: auditLogs.length, verified_count: auditLogs.length });
            } else {
                const res = await api.verifyAuditChain();
                if (res.success && res.data) {
                    setVerificationResult(res.data);
                } else {
                    alert('Verification failed: ' + res.error);
                }
            }
        } catch (e: any) {
            alert('Verification error: ' + e.message);
        } finally {
            setVerifyingAudit(false);
        }
    };

    const fetchAuditLogs = async () => {
        if (isDemoMode) {
            setAuditLogs([
                { created_at: new Date().toISOString(), username: 'admin', action: 'LOGIN', detail: 'Successful authentication' },
                { created_at: new Date(Date.now() - 100000).toISOString(), username: 'system', action: 'JOB_START', detail: 'Job #1002 started' }
            ]);
            return;
        }
        setAuditLoading(true);
        const res = await api.getAuditLog(50);
        if (res.success && res.data) {
            setAuditLogs(res.data.entries);
        }
        setAuditLoading(false);
    };

    const fetchAuditVerificationHistory = async () => {
        if (isDemoMode) {
            setAuditVerificationHistory([
                { timestamp: new Date().toISOString(), valid: true, total_entries: 150, verified_count: 150 }
            ]);
            return;
        }
        try {
            const res = await api.getAuditVerificationHistory(10);
            if (res.success && res.data) {
                setAuditVerificationHistory(res.data.history);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleRotateKmsKey = async () => {
        if (!window.confirm("Are you sure you want to rotate the master encryption key? This is only for the local provider.")) return;

        try {
            const res = await api.rotateKmsKey();
            if (res.success) {
                alert("Master key rotated successfully.");
            } else {
                alert("Rotation failed: " + res.error);
            }
        } catch (e) {
            alert("Network error");
        }
    };

    const handleSyncCatalog = async () => {
        setSyncLoading(true);
        try {
            if (isDemoMode) {
                await new Promise(r => setTimeout(r, 1000));
                alert("Demo Mode: Catalog synced to cloud destinations.");
            } else {
                const res = await api.syncCatalog();
                if (res.success) {
                    alert(`Sync successful: ${res.data?.message || 'Done'}`);
                } else {
                    alert(`Sync failed: ${res.error}`);
                }
            }
        } catch (e: any) {
            alert("Error: " + e.message);
        } finally {
            setSyncLoading(false);
        }
    };

    return (
        <div className="flex flex-col gap-8">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-white uppercase antialiased">System Settings</h1>
                    <div className="flex items-center gap-2 mt-1">
                        {isDemoMode && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-warning/10 text-warning border border-warning/20 uppercase tracking-widest">Demo Mode</span>
                        )}
                    </div>
                </div>
                <button
                    onClick={() => logout()}
                    className="text-[10px] font-bold text-[#71717a] hover:text-destructive uppercase tracking-widest flex items-center gap-2"
                >
                    <span className="material-symbols-outlined text-lg">logout</span>
                    Sign Out
                </button>
            </header>

            {/* Tab Navigation */}
            <div className="flex border-b border-[#27272a] -mx-6 px-6">
                {TABS.map(tab => (
                    <button
                        key={tab}
                        onClick={() => handleTabChange(tab)}
                        className={cn(
                            "px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] transition-all border-b-2",
                            activeTab === tab ? "text-primary border-primary bg-primary/5" : "text-[#71717a] border-transparent hover:text-white"
                        )}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* General Tab */}
            {activeTab === 'General' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Demo Mode Toggle */}
                    <div className="bg-[#121214] border border-[#27272a] rounded p-6">
                        <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em] mb-4">Demo Mode</h3>
                        <p className="text-[10px] text-[#71717a] mb-6">Enable demo mode to use mock data without requiring backend or hardware connectivity.</p>
                        <label className="flex items-center gap-4 cursor-pointer group">
                            <div className="relative">
                                <input type="checkbox" className="sr-only peer" checked={isDemoMode} onChange={toggleDemoMode} />
                                <div className="w-11 h-6 bg-[#27272a] rounded-full peer peer-checked:bg-primary transition-all"></div>
                                <div className="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-all peer-checked:left-6"></div>
                            </div>
                            <span className="text-[10px] font-bold text-[#71717a] group-hover:text-white uppercase tracking-widest transition-colors">
                                {isDemoMode ? 'Demo Mode Enabled' : 'Demo Mode Disabled'}
                            </span>
                        </label>
                        {isDemoMode && (
                            <div className="mt-4 p-3 rounded bg-warning/10 border border-warning/20 text-warning text-[10px]">
                                <strong>Warning:</strong> Demo mode is active. All data is simulated.
                            </div>
                        )}

                    </div>

                    {/* System Info */}
                    <div className="bg-[#121214] border border-[#27272a] rounded p-6 font-mono">
                        <h3 className="font-sans text-xs font-bold text-white uppercase tracking-[0.25em] mb-6">System Information</h3>
                        <div className="space-y-4">
                            {[
                                { l: 'Hostname', v: systemInfo?.hostname || 'FS-PROD-01' },
                                { l: 'Backend', v: isDemoMode ? 'Demo Mode' : 'Connected', c: isDemoMode ? 'text-warning' : 'text-primary' },
                                { l: 'Uptime', v: systemInfo?.uptime ? `${Math.floor(systemInfo.uptime / 3600)}h ${Math.floor((systemInfo.uptime % 3600) / 60)} m` : '0h 0m' }
                            ].map((stat, i) => (
                                <div key={i} className="flex justify-between items-center pb-3 border-b border-[#27272a] last:border-0 last:pb-0">
                                    <span className="text-[9px] text-[#71717a] uppercase tracking-widest">{stat.l}</span>
                                    <span className={cn("text-[10px] font-bold uppercase", stat.c || "text-white/80")}>{stat.v}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}


            {/* Sources Tab */}
            {activeTab === 'Sources' && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em]">Data Sources</h3>
                            <p className="text-[10px] text-[#71717a] mt-1 font-bold uppercase tracking-wider">Configure SMB shares, NFS mounts, and object storage</p>
                        </div>
                        <button
                            onClick={() => setShowSourceModal(true)}
                            className="px-4 py-2 bg-primary hover:bg-green-400 text-black font-bold rounded text-[10px] uppercase tracking-[0.2em] flex items-center gap-2 shadow-[0_4px_12px_rgba(25,230,100,0.2)] transition-all"
                        >
                            <span className="material-symbols-outlined text-sm">add</span>
                            Add Source
                        </button>
                    </div>

                    <div className="bg-[#121214] border border-[#27272a] rounded overflow-hidden">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-[#18181b] text-[9px] font-bold uppercase tracking-widest text-[#71717a] border-b border-[#27272a]">
                                <tr>
                                    <th className="px-6 py-4">Name</th>
                                    <th className="px-6 py-4">Type</th>
                                    <th className="px-6 py-4">Configuration</th>
                                    <th className="px-6 py-4">Created At</th>
                                    <th className="px-6 py-4 w-12"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#27272a]">
                                {sourcesLoading ? (
                                    <tr><td colSpan={5} className="px-6 py-8 text-center text-[#71717a]">Loading sources...</td></tr>
                                ) : sources.length === 0 ? (
                                    <tr><td colSpan={5} className="px-6 py-12 text-center text-[#71717a] flex flex-col items-center gap-2">
                                        <span className="material-symbols-outlined text-4xl opacity-50">folder_off</span>
                                        No sources configured
                                    </td></tr>
                                ) : sources.map((source) => (
                                    <tr key={source.id} className="hover:bg-white/[0.02] transition-colors group">
                                        <td className="px-6 py-4 font-mono text-white font-bold">{source.name}</td>
                                        <td className="px-6 py-4">
                                            <span className={cn(
                                                "px-2 py-1 rounded border text-[9px] font-bold uppercase tracking-widest",
                                                source.type === 'smb' ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                                                    source.type === 's3' ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                                                        "bg-[#27272a] text-[#71717a] border-[#3f3f46]"
                                            )}>
                                                {source.type}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-[10px] text-[#a1a1aa] truncate max-w-[200px]">
                                            {source.type === 'smb' ? source.config.path :
                                                source.type === 's3' ? `${source.config.bucket} @${source.config.endpoint} ` :
                                                    JSON.stringify(source.config)}
                                        </td>
                                        <td className="px-6 py-4 text-[#71717a] font-mono text-[10px] uppercase">
                                            {new Date(source.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => handleDeleteSource(source.id)}
                                                className="text-[#71717a] hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                                            >
                                                <span className="material-symbols-outlined text-lg">delete</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )
            }

            {/* Users Tab */}
            {
                activeTab === 'Users' && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em]">User Management</h3>
                            <button
                                onClick={() => setShowUserModal(true)}
                                className="px-4 py-2 bg-primary hover:bg-green-400 text-black font-bold rounded text-[10px] uppercase tracking-[0.2em] flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined text-sm">person_add</span>
                                Add User
                            </button>
                        </div>

                        <div className="bg-[#121214] border border-[#27272a] rounded">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-[#18181b] text-[9px] font-bold uppercase tracking-widest text-[#71717a] border-b border-[#27272a]">
                                    <tr>
                                        <th className="px-4 py-4">Username</th>
                                        <th className="px-4 py-4">Role</th>
                                        <th className="px-4 py-4">Status</th>
                                        <th className="px-4 py-4">2FA</th>
                                        <th className="px-4 py-4 w-12"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#27272a]">
                                    {users.map((user, i) => (
                                        <tr key={i} className="group hover:bg-white/[0.02] transition-colors">
                                            <td className="px-4 py-4 font-mono text-white">{user.username}</td>
                                            <td className="px-4 py-4 text-[10px] uppercase tracking-widest text-[#71717a]">{user.role}</td>
                                            <td className="px-4 py-4">
                                                <span className={cn("text-[10px] font-bold uppercase tracking-widest", user.is_active ? "text-primary" : "text-destructive")}>
                                                    {user.is_active ? 'Active' : 'Disabled'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                {user.has_2fa ? (
                                                    <span className="material-symbols-outlined text-primary text-sm">verified_user</span>
                                                ) : (
                                                    <span className="material-symbols-outlined text-[#71717a] text-sm">gpp_maybe</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-4 text-right relative">
                                                <button
                                                    onClick={() => setOpenUserMenu(openUserMenu === user.id ? null : user.id)}
                                                    className="text-[#71717a] hover:text-white transition-colors"
                                                >
                                                    <span className="material-symbols-outlined text-lg">more_vert</span>
                                                </button>

                                                {openUserMenu === user.id && (
                                                    <>
                                                        <div
                                                            className="fixed inset-0 z-40"
                                                            onClick={() => setOpenUserMenu(null)}
                                                        ></div>
                                                        <div className="absolute right-0 top-full mt-1 w-48 bg-[#18181b] border border-[#27272a] rounded shadow-2xl z-50 overflow-hidden">
                                                            <button
                                                                disabled={!user.has_2fa}
                                                                onClick={() => {
                                                                    setOpenUserMenu(null);
                                                                    handleReset2FA(user.id, user.username);
                                                                }}
                                                                className="w-full px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-left hover:bg-white/[0.05] flex items-center gap-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                            >
                                                                <span className="material-symbols-outlined text-sm text-warning">lock_reset</span>
                                                                Reset 2FA
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    handleDeleteUser(user.id, user.username);
                                                                    setOpenUserMenu(null);
                                                                }}
                                                                disabled={currentUser?.id === user.id}
                                                                className={cn(
                                                                    "w-full flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors text-left",
                                                                    currentUser?.id === user.id ? "text-muted-foreground opacity-50 cursor-not-allowed" : "text-destructive hover:bg-destructive/10"
                                                                )}
                                                            >
                                                                <span className="material-symbols-outlined text-sm">delete</span>
                                                                Delete User {currentUser?.id === user.id && "(Self)"}
                                                            </button>
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            }

            {/* SSO/OIDC Tab */}
            {
                activeTab === 'SSO/OIDC' && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            <div className="lg:col-span-2 space-y-8">
                                <div className="bg-[#121214] border border-[#27272a] rounded p-8 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-transparent to-primary/5 pointer-events-none"></div>

                                    <div className="flex items-center justify-between mb-8">
                                        <div>
                                            <h2 className="text-xs font-bold text-white uppercase tracking-[0.25em]">OIDC Identity Provider</h2>
                                            <p className="text-[10px] text-[#71717a] mt-1.5 font-bold uppercase tracking-wider">Authentication management & security tokens</p>
                                        </div>
                                        <div className={cn("flex items-center gap-2 px-3 py-1 rounded border", ssoEnabled ? "bg-primary/10 border-primary/20 text-primary" : "bg-[#27272a] border-[#3f3f46] text-[#71717a]")}>
                                            <span className="text-[9px] font-bold font-mono uppercase tracking-widest">{ssoEnabled ? 'Active' : 'Not Configured'}</span>
                                        </div>
                                    </div>

                                    {ssoError && (
                                        <div className="mb-6 p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                                            {ssoError}
                                        </div>
                                    )}
                                    {ssoSuccess && (
                                        <div className="mb-6 p-3 rounded bg-primary/10 border border-primary/20 text-primary text-xs">
                                            {ssoSuccess}
                                        </div>
                                    )}

                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-[0.2em] px-1">Issuer URL</label>
                                            <input
                                                className="w-full bg-black/40 border border-[#27272a] rounded px-4 py-3 font-mono text-[11px] text-white focus:border-primary/50 outline-none transition-all"
                                                type="text"
                                                value={ssoIssuer}
                                                onChange={(e) => setSsoIssuer(e.target.value)}
                                                placeholder="https://auth.example.com"
                                            />
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-[0.2em] px-1">Client ID</label>
                                                <input
                                                    className="w-full bg-black/40 border border-[#27272a] rounded px-4 py-3 font-mono text-[11px] text-white focus:border-primary/50 outline-none transition-all"
                                                    type="text"
                                                    value={ssoClientId}
                                                    onChange={(e) => setSsoClientId(e.target.value)}
                                                    placeholder="fossilsafe-client"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-[0.2em] px-1">Client Secret</label>
                                                <input
                                                    className="w-full bg-black/40 border border-[#27272a] rounded px-4 py-3 font-mono text-[11px] text-white focus:border-primary/50 outline-none transition-all tracking-[0.5em]"
                                                    type="password"
                                                    value={ssoClientSecret}
                                                    onChange={(e) => setSsoClientSecret(e.target.value)}
                                                    placeholder="••••••••"
                                                />
                                            </div>
                                        </div>

                                        <div className="pt-2">
                                            <label className="flex items-center gap-3 cursor-pointer group">
                                                <div className="relative">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={ssoEnabled}
                                                        onChange={(e) => setSsoEnabled(e.target.checked)}
                                                    />
                                                    <div className="w-9 h-5 bg-[#27272a] rounded-full peer peer-checked:bg-primary transition-all"></div>
                                                    <div className="absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-all peer-checked:left-5"></div>
                                                </div>
                                                <span className="text-[10px] font-bold text-[#71717a] group-hover:text-white uppercase tracking-widest transition-colors">Enable SSO</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-4">
                                    <button
                                        onClick={handleSSOSave}
                                        disabled={ssoLoading}
                                        className={cn(
                                            "px-8 py-3 bg-primary hover:bg-green-400 text-black font-bold rounded shadow-[0_4px_12px_rgba(25,230,100,0.2)] text-[10px] transition-all flex items-center gap-2 uppercase tracking-[0.2em]",
                                            ssoLoading && "opacity-50 cursor-not-allowed"
                                        )}
                                    >
                                        <span className="material-symbols-outlined text-lg">save</span>
                                        {ssoLoading ? 'Saving...' : 'Save Configuration'}
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="bg-[#121214] border border-[#27272a] rounded p-6">
                                    <h3 className="text-[9px] font-bold text-[#71717a] uppercase tracking-[0.3em] mb-4">SSO Status</h3>
                                    <div className="space-y-3 font-mono text-[10px]">
                                        <div className="flex justify-between">
                                            <span className="text-[#71717a]">Enabled</span>
                                            <span className={ssoEnabled ? "text-primary" : "text-white"}>{ssoEnabled ? 'Yes' : 'No'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-[#71717a]">Provider</span>
                                            <span className="text-white">{ssoIssuer ? new URL(ssoIssuer).hostname : '—'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                )
            }

            {/* Audit Log Tab */}
            {/* Notifications Tab */}
            {
                activeTab === 'Notifications' && (
                    <div className="space-y-8">
                        <header className="flex items-center justify-between">
                            <div>
                                <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em]">Notification Settings</h3>
                                <p className="text-[10px] text-[#71717a] mt-1 font-bold uppercase tracking-wider">Configure system alerts and status updates</p>
                            </div>
                            <button
                                onClick={handleNotifSave}
                                disabled={notifLoading}
                                className={cn(
                                    "px-6 py-2 bg-primary hover:bg-green-400 text-black font-bold rounded text-[10px] uppercase tracking-[0.2em] shadow-[0_4px_12px_rgba(25,230,100,0.2)] transition-all flex items-center gap-2",
                                    notifLoading && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                <span className="material-symbols-outlined text-sm">save</span>
                                {notifLoading ? 'Saving...' : 'Save Settings'}
                            </button>
                        </header>

                        {notifSuccess && (
                            <div className="p-3 rounded bg-primary/10 border border-primary/20 text-primary text-xs font-bold animate-in fade-in slide-in-from-top-1">
                                {notifSuccess}
                            </div>
                        )}
                        {notifError && (
                            <div className="p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs font-bold animate-in fade-in slide-in-from-top-1">
                                {notifError}
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* SMTP Settings */}
                            <div className="bg-[#121214] border border-[#27272a] rounded p-6 space-y-6">
                                <div className="flex items-center justify-between border-b border-[#27272a] pb-4">
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-primary">mail</span>
                                        <h4 className="text-[10px] font-bold text-white uppercase tracking-[0.2em]">SMTP (Email Alerts)</h4>
                                    </div>
                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={notificationConfig.smtp.enabled}
                                                onChange={(e) => setNotificationConfig({ ...notificationConfig, smtp: { ...notificationConfig.smtp, enabled: e.target.checked } })}
                                            />
                                            <div className="w-9 h-5 bg-[#27272a] rounded-full peer peer-checked:bg-primary transition-all"></div>
                                            <div className="absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-all peer-checked:left-5"></div>
                                        </div>
                                        <span className="text-[9px] font-bold text-[#71717a] group-hover:text-white uppercase tracking-widest transition-colors">Enabled</span>
                                    </label>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">SMTP Host</label>
                                        <input
                                            type="text"
                                            value={notificationConfig.smtp.host}
                                            onChange={(e) => setNotificationConfig({ ...notificationConfig, smtp: { ...notificationConfig.smtp, host: e.target.value } })}
                                            className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:border-primary/50 outline-none transition-all"
                                            placeholder="smtp.example.com"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">Port</label>
                                        <input
                                            type="number"
                                            value={notificationConfig.smtp.port}
                                            onChange={(e) => setNotificationConfig({ ...notificationConfig, smtp: { ...notificationConfig.smtp, port: Number(e.target.value) } })}
                                            className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:border-primary/50 outline-none transition-all"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">Username</label>
                                        <input
                                            type="text"
                                            value={notificationConfig.smtp.user}
                                            onChange={(e) => setNotificationConfig({ ...notificationConfig, smtp: { ...notificationConfig.smtp, user: e.target.value } })}
                                            className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs text-white focus:border-primary/50 outline-none transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">Password</label>
                                        <input
                                            type="password"
                                            value={notificationConfig.smtp.password}
                                            onChange={(e) => setNotificationConfig({ ...notificationConfig, smtp: { ...notificationConfig.smtp, password: e.target.value } })}
                                            className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs text-white focus:border-primary/50 outline-none transition-all tracking-[0.3em]"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center justify-between items-center pt-2">
                                    <button
                                        onClick={() => handleTestNotif('smtp')}
                                        disabled={testingProvider === 'smtp' || !notificationConfig.smtp.host}
                                        className="px-4 py-2 bg-[#18181b] border border-[#27272a] text-[#71717a] hover:text-white rounded text-[9px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-30"
                                    >
                                        <span className={cn("material-symbols-outlined text-[16px]", testingProvider === 'smtp' && "animate-spin")}>
                                            {testingProvider === 'smtp' ? 'sync' : 'send'}
                                        </span>
                                        {testingProvider === 'smtp' ? 'Testing...' : 'Test Connection'}
                                    </button>
                                    <div className="flex items-center gap-4">
                                        <span className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest">Encryption:</span>
                                        <select
                                            value={notificationConfig.smtp.encryption}
                                            onChange={(e) => setNotificationConfig({ ...notificationConfig, smtp: { ...notificationConfig.smtp, encryption: e.target.value } })}
                                            className="bg-black/40 border border-[#27272a] rounded text-[10px] text-white px-2 py-1 outline-none font-mono"
                                        >
                                            <option value="none">None</option>
                                            <option value="starttls">STARTTLS</option>
                                            <option value="ssl">SSL/TLS</option>
                                        </select>
                                    </div>
                                </div>
                            </div>



                            {/* SNMP Settings */}
                                <div className="bg-[#121214] border border-[#27272a] rounded p-6 space-y-6 relative overflow-hidden">
                                    <div className="flex items-center justify-between border-b border-[#27272a] pb-4">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-primary">settings_input_component</span>
                                            <h4 className="text-[10px] font-bold text-white uppercase tracking-[0.2em]">SNMP Traps</h4>
                                        </div>
                                        <label className="flex items-center gap-3 cursor-pointer group">
                                            <div className="relative">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={notificationConfig.snmp.enabled}
                                                    onChange={(e) => setNotificationConfig({ ...notificationConfig, snmp: { ...notificationConfig.snmp, enabled: e.target.checked } })}
                                                />
                                                <div className="w-9 h-5 bg-[#27272a] rounded-full peer peer-checked:bg-primary transition-all"></div>
                                                <div className="absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-all peer-checked:left-5"></div>
                                            </div>
                                            <span className="text-[9px] font-bold text-[#71717a] group-hover:text-white uppercase tracking-widest transition-colors">Enabled</span>
                                        </label>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">Target Host</label>
                                            <input
                                                type="text"
                                                value={notificationConfig.snmp.target_host}
                                                onChange={(e) => setNotificationConfig({ ...notificationConfig, snmp: { ...notificationConfig.snmp, target_host: e.target.value } })}
                                                className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:border-primary/50 outline-none transition-all"
                                                placeholder="10.0.0.1"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">Community String</label>
                                            <input
                                                type="text"
                                                value={notificationConfig.snmp.community}
                                                onChange={(e) => setNotificationConfig({ ...notificationConfig, snmp: { ...notificationConfig.snmp, community: e.target.value } })}
                                                className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:border-primary/50 outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            onClick={() => handleTestNotif('snmp')}
                                            disabled={testingProvider === 'snmp' || !notificationConfig.snmp.target_host}
                                            className="px-4 py-2 bg-[#18181b] border border-[#27272a] text-[#71717a] hover:text-white rounded text-[9px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-30"
                                        >
                                            <span className={cn("material-symbols-outlined text-[16px]", testingProvider === 'snmp' && "animate-spin")}>
                                                {testingProvider === 'snmp' ? 'sync' : 'send'}
                                            </span>
                                            {testingProvider === 'snmp' ? 'Testing...' : 'Test Traps'}
                                        </button>
                                    </div>
                                </div>
                        </div>
                    </div>
                )
            }

            {/* Automation Tab */}
            {
                activeTab === 'Automation' && (
                        <WebhooksPanel />
                )
            }

            {
                activeTab === 'Audit Log' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em]">Audit Trail</h3>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleGenerateComplianceReport}
                                        disabled={generatingReport}
                                        className={cn(
                                            "px-4 py-2 bg-primary text-black font-bold rounded text-[10px] uppercase tracking-[0.2em] flex items-center gap-2 transition-all hover:bg-green-400 shadow-[0_4px_12px_rgba(25,230,100,0.1)]",
                                            generatingReport && "opacity-50"
                                        )}
                                    >
                                        <span className={cn("material-symbols-outlined text-sm", generatingReport && "animate-spin")}>
                                            {generatingReport ? 'history_edu' : 'assignment_turned_in'}
                                        </span>
                                        {generatingReport ? 'Generating Report...' : 'Compliance Report'}
                                    </button>
                                    <button
                                        onClick={handleVerifyAudit}
                                        disabled={verifyingAudit}
                                        className={cn(
                                            "px-4 py-2 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white font-bold rounded text-[10px] uppercase tracking-[0.2em] flex items-center gap-2 transition-all",
                                            verifyingAudit && "opacity-50"
                                        )}
                                    >
                                        <span className={cn("material-symbols-outlined text-sm", verifyingAudit && "animate-spin")}>
                                            {verifyingAudit ? 'sync' : 'verified_user'}
                                        </span>
                                        {verifyingAudit ? 'Verifying...' : 'Integrity Check'}
                                    </button>
                                    <button className="px-4 py-2 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white font-bold rounded text-[10px] uppercase tracking-[0.2em] flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm">download</span>
                                        Export CSV
                                    </button>
                                </div>
                            </div>

                            {verificationResult && (
                                <div className={cn(
                                    "p-4 rounded border animate-in slide-in-from-top-2 mb-6",
                                    verificationResult.valid ? "bg-primary/10 border-primary/20" : "bg-destructive/10 border-destructive/20"
                                )}>
                                    <div className="flex items-center gap-3">
                                        <span className={cn("material-symbols-outlined", verificationResult.valid ? "text-primary" : "text-destructive")}>
                                            {verificationResult.valid ? 'verified' : 'warning'}
                                        </span>
                                        <div>
                                            <p className="text-[10px] font-bold text-white uppercase tracking-wider">
                                                {verificationResult.valid ? 'Log Integrity Verified' : 'Integrity Check Failed'}
                                            </p>
                                            <p className="text-[9px] text-[#71717a] mt-1">
                                                {verificationResult.valid
                                                    ? `Chain of ${verificationResult.total_entries} entries is cryptographically sound.`
                                                    : verificationResult.error || 'Chain integrity compromised.'
                                                }
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="bg-[#121214] border border-[#27272a] rounded overflow-hidden">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-[#18181b] text-[9px] font-bold uppercase tracking-widest text-[#71717a] border-b border-[#27272a]">
                                        <tr>
                                            <th className="px-4 py-4">Timestamp</th>
                                            <th className="px-4 py-4">User</th>
                                            <th className="px-4 py-4">Action</th>
                                            <th className="px-4 py-4">Details</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#27272a]">
                                        {auditLoading ? (
                                            <tr><td colSpan={4} className="px-4 py-8 text-center text-[#71717a]">Loading logs...</td></tr>
                                        ) : auditLogs.length === 0 ? (
                                            <tr><td colSpan={4} className="px-4 py-8 text-center text-[#71717a]">No audit entries found</td></tr>
                                        ) : auditLogs.map((log, i) => (
                                            <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                                <td className="px-4 py-4 font-mono text-[#71717a] text-[10px]">{new Date(log.created_at).toLocaleString()}</td>
                                                <td className="px-4 py-4 font-mono text-white">{log.username}</td>
                                                <td className="px-4 py-4">
                                                    <span className="px-2 py-1 rounded bg-[#18181b] border border-[#27272a] text-[9px] font-bold uppercase tracking-widest">{log.action}</span>
                                                </td>
                                                <td className="px-4 py-4 text-[#71717a]">{log.detail || log.message}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Verification History */}
                            {auditVerificationHistory.length > 0 && (
                                <div className="space-y-4">
                                    <h4 className="text-[10px] font-bold text-[#71717a] uppercase tracking-widest px-1">Verification History</h4>
                                    <div className="bg-[#121214] border border-[#27272a] rounded overflow-hidden">
                                        <table className="w-full text-left text-[10px]">
                                            <thead className="bg-[#18181b] text-[8px] font-bold uppercase tracking-widest text-[#71717a] border-b border-[#27272a]">
                                                <tr>
                                                    <th className="px-4 py-3">Timestamp</th>
                                                    <th className="px-4 py-3">Result</th>
                                                    <th className="px-4 py-3">Entries</th>
                                                    <th className="px-4 py-3">Details</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#27272a]">
                                                {auditVerificationHistory.map((h, i) => (
                                                    <tr key={i} className="hover:bg-white/[0.01]">
                                                        <td className="px-4 py-3 text-[#71717a]">{new Date(h.timestamp).toLocaleString()}</td>
                                                        <td className="px-4 py-3">
                                                            {h.valid ? (
                                                                <span className="text-primary font-bold">VALID</span>
                                                            ) : (
                                                                <span className="text-destructive font-bold">FAILED</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-white">{h.total_entries}</td>
                                                        <td className="px-4 py-3 text-[#71717a]">{h.error_message || 'OK'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                )
            }

            {/* Diagnostics Tab */}
            {
                activeTab === 'Diagnostics' && (
                    <div className="space-y-8">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Health Overview */}
                            <div className="bg-[#121214] border border-[#27272a] rounded p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em]">System Health</h3>
                                    <button
                                        onClick={fetchDiagnosticsHealth}
                                        disabled={diagLoading}
                                        className="text-[#71717a] hover:text-white transition-colors"
                                    >
                                        <span className={cn("material-symbols-outlined text-sm", diagLoading && "animate-spin")}>refresh</span>
                                    </button>
                                </div>

                                {diagLoading && !diagnosticsHealth ? (
                                    <div className="py-12 flex flex-col items-center justify-center text-[#3f3f46]">
                                        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mb-4"></div>
                                        <span className="text-[10px] font-bold uppercase tracking-widest">Polling Health Data...</span>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {diagnosticsHealth?.checks ? (
                                            Object.entries(diagnosticsHealth.checks).map(([key, check]: [string, any]) => (
                                                <div key={key} className="flex items-center justify-between p-3 bg-[#18181b] border border-[#27272a] rounded">
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            "size-2 rounded-full",
                                                            check.status === 'ok' || check.status === 'healthy' ? "bg-primary shadow-[0_0_8px_rgba(25,230,100,0.5)]" :
                                                                check.status === 'warning' ? "bg-warning shadow-[0_0_8px_rgba(234,179,8,0.5)]" :
                                                                    "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                                                        )}></div>
                                                        <span className="text-[10px] font-bold text-white uppercase tracking-wider">{key.replace(/_/g, ' ')}</span>
                                                    </div>
                                                    <span className="text-[9px] font-mono text-[#71717a]">{check.message || check.status}</span>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="py-8 text-center text-[#3f3f46] text-[10px] items-center italic">
                                                No health check data available. Run diagnostics to populate.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="space-y-8">
                                <div className="bg-[#121214] border border-[#27272a] rounded p-6">
                                    <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em] mb-4">Infrastructure Diagnostics</h3>
                                    <p className="text-[10px] text-[#71717a] mb-6">Execution of deep hardware probes, tape drive latency tests, and library inventory calibration.</p>
                                    <button
                                        onClick={handleRunDiagnostics}
                                        className="w-full py-4 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-white font-bold rounded text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-all group"
                                    >
                                        <span className="material-symbols-outlined text-primary group-hover:scale-110 transition-transform">precision_manufacturing</span>
                                        Initialize Deep Hardware Probe
                                    </button>
                                </div>

                                <div className="bg-[#121214] border border-[#27272a] rounded p-6">
                                    <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em] mb-4">Support Bundle</h3>
                                    <p className="text-[10px] text-[#71717a] mb-6">Generate a redacted archive containing system metrics, hardware logs, and performance statistics for technical analysis.</p>

                                    {!bundleResult ? (
                                        <button
                                            onClick={handleGenerateBundle}
                                            disabled={bundleLoading}
                                            className="w-full py-4 bg-primary text-black font-bold rounded text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-3 transition-all hover:bg-green-400 disabled:opacity-50 shadow-[0_4px_20px_rgba(25,230,100,0.1)] active:scale-[0.98]"
                                        >
                                            {bundleLoading ? (
                                                <>
                                                    <div className="size-4 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>
                                                    Archiving...
                                                </>
                                            ) : (
                                                <>
                                                    <span className="material-symbols-outlined font-black">package_2</span>
                                                    Collect Support Bundle
                                                </>
                                            )}
                                        </button>
                                    ) : (
                                        <div className="space-y-3 animate-in zoom-in-95 duration-300">
                                            <div className="p-3 bg-primary/10 border border-primary/20 rounded flex items-center gap-3">
                                                <span className="material-symbols-outlined text-primary">check_circle</span>
                                                <div className="flex-1">
                                                    <p className="text-[10px] font-bold text-white uppercase">Bundle Ready</p>
                                                    <p className="text-[9px] text-primary/80 font-mono mt-1 truncate">{bundleResult.bundle_path.split('/').pop()}</p>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <a
                                                    href={api.getSupportBundleUrl(bundleResult.bundle_path)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="py-3 bg-white text-black font-bold rounded text-[9px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[#71717a] transition-all"
                                                >
                                                    <span className="material-symbols-outlined text-sm">download</span>
                                                    Download
                                                </a>
                                                <button
                                                    onClick={() => setBundleResult(null)}
                                                    className="py-3 bg-[#18181b] border border-[#27272a] text-[#71717a] font-bold rounded text-[9px] uppercase tracking-widest hover:text-white transition-all"
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <DiagnosticsHistory />
                    </div>
                )
            }

            {/* Maintenance Tab */}
            {
                activeTab === 'Maintenance' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Catalog Management */}
                        <div className="bg-[#121214] border border-[#27272a] rounded p-6">
                            <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em] mb-4">Catalog Operations</h3>
                            <p className="text-[10px] text-[#71717a] mb-6">Manage the internal file catalog database. Regular exports are recommended for disaster recovery.</p>

                            <div className="space-y-3">
                                <button
                                    onClick={() => setShowExportModal(true)}
                                    className="w-full py-3 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-white font-bold rounded text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all"
                                >
                                    <span className="material-symbols-outlined text-sm">save</span>
                                    Export Catalog to Tape
                                </button>
                                <button
                                    onClick={handleSyncCatalog}
                                    disabled={syncLoading}
                                    className={cn(
                                        "w-full py-3 border border-primary/20 bg-primary/10 hover:bg-primary/20 text-primary font-bold rounded text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all",
                                        syncLoading && "opacity-50"
                                    )}
                                >
                                    {syncLoading ? (
                                        <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                        <span className="material-symbols-outlined text-sm">cloud_upload</span>
                                    )}
                                    Cloud Replication
                                </button>
                            </div>
                        </div>

                        {/* Library Configuration */}
                        <div className="bg-[#121214] border border-[#27272a] rounded p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em]">Library Configuration</h3>
                                {mailSlotLoading && <Loader2 className="size-3 animate-spin text-primary" />}
                            </div>
                            <div className="space-y-4">
                                <div className="p-3 bg-[#18181b] rounded border border-[#27272a]">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex-1 pr-4">
                                            <span className="block text-[10px] font-bold text-white uppercase tracking-wider mb-1">Mail Slots (Import/Export)</span>
                                            <span className="block text-[9px] text-[#71717a] leading-tight">Enable dedicated ports for tape import/export operations</span>
                                        </div>
                                        <label className="flex items-center cursor-pointer group shrink-0">
                                            <div className="relative">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={mailSlotConfig.enabled}
                                                    onChange={(e) => handleUpdateMailSlotConfig({ enabled: e.target.checked })}
                                                />
                                                <div className="w-9 h-5 bg-[#27272a] rounded-full peer peer-checked:bg-primary transition-all"></div>
                                                <div className="absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-all peer-checked:left-5"></div>
                                            </div>
                                        </label>
                                    </div>

                                    {mailSlotConfig.enabled && (
                                        <div className="mt-4 pt-4 border-t border-[#27272a] space-y-4 animate-in fade-in slide-in-from-top-2">
                                            <div className="flex items-center justify-between">
                                                <div className="flex-1 pr-4">
                                                    <span className="block text-[10px] font-bold text-white uppercase tracking-wider mb-1">Auto-Detect Slots</span>
                                                    <span className="block text-[9px] text-[#71717a] leading-tight">Identify mail slots via SCSI Element Geometry descriptors (recommended)</span>
                                                </div>
                                                <label className="flex items-center cursor-pointer group shrink-0">
                                                    <div className="relative">
                                                        <input
                                                            type="checkbox"
                                                            className="sr-only peer"
                                                            checked={mailSlotConfig.auto_detect}
                                                            onChange={(e) => handleUpdateMailSlotConfig({ auto_detect: e.target.checked })}
                                                        />
                                                        <div className="w-9 h-5 bg-[#27272a] rounded-full peer peer-checked:bg-primary transition-all"></div>
                                                        <div className="absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-all peer-checked:left-5"></div>
                                                    </div>
                                                </label>
                                            </div>

                                            {!mailSlotConfig.auto_detect && (
                                                <div className="flex items-center justify-between pt-2 animate-in fade-in slide-in-from-top-1">
                                                    <div className="flex-1 pr-4">
                                                        <span className="block text-[10px] font-bold text-white uppercase tracking-wider mb-1">Start Index (Manual)</span>
                                                        <span className="block text-[9px] text-[#71717a] leading-tight">Slots from this index to the end will be treated as mail slots</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <input 
                                                            type="number"
                                                            min="1"
                                                            max="1000"
                                                            value={mailSlotConfig.manual_index || ""}
                                                            placeholder="e.g. 24"
                                                            onChange={(e) => {
                                                                const val = parseInt(e.target.value);
                                                                if (!isNaN(val)) setMailSlotConfig({...mailSlotConfig, manual_index: val});
                                                            }}
                                                            onBlur={(e) => {
                                                                const val = parseInt(e.target.value);
                                                                handleUpdateMailSlotConfig({ manual_index: isNaN(val) ? null : val });
                                                            }}
                                                            className="w-20 bg-black/40 border border-[#27272a] rounded text-[10px] text-white px-3 py-1 outline-none font-mono focus:border-primary/50"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Log Management */}
                        <div className="bg-[#121214] border border-[#27272a] rounded p-6">
                            <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em] mb-4">System Logs</h3>
                            <div className="flex items-center justify-between mb-4 p-3 bg-[#18181b] rounded border border-[#27272a]">
                                <span className="text-[10px] text-[#71717a] uppercase tracking-wider">Log Retention Policy</span>
                                <select
                                    onChange={(e) => {
                                        const days = e.target.value;
                                        setConfirmModal({
                                            isOpen: true,
                                            title: 'Log Cleanup',
                                            message: `Apply retention policy? Logs older than ${days} days will be deleted.`,
                                            variant: 'warning',
                                            onConfirm: async () => {
                                                if (isDemoMode) {
                                                    alert('Demo Mode: Logs would be cleaned up.');
                                                } else {
                                                    api.cleanupLogs(Number(days)).then(res => {
                                                        if (res.success) console.log(`Cleanup successful. Deleted ${res.data?.deleted_count} entries.`);
                                                        else console.error('Cleanup failed: ' + res.error);
                                                    });
                                                }
                                            }
                                        });
                                    }}
                                    className="bg-black/40 border border-[#27272a] rounded text-[10px] text-white px-2 py-1 outline-none cursor-pointer hover:border-primary/50 transition-colors"
                                >
                                    <option value="0">No Logs (Purge All)</option>
                                    <option value="7">Keep 7 Days</option>
                                    <option value="30">Keep 30 Days</option>
                                    <option value="90">Keep 90 Days</option>
                                    <option value="365">Keep 1 Year</option>
                                </select>
                            </div>
                            <button
                                onClick={async () => {
                                    setConfirmModal({
                                        isOpen: true,
                                        title: 'Clear All Logs',
                                        message: 'Are you sure you want to clear ALL system logs? This action cannot be undone.',
                                        variant: 'danger',
                                        confirmText: 'Clear Logs',
                                        onConfirm: async () => {
                                            if (isDemoMode) {
                                                alert('Demo Mode: All logs would be cleared.');
                                            } else {
                                                const res = await api.cleanupLogs(0);
                                                if (res.success) console.log(`Logs cleared. Deleted ${res.data?.deleted_count} entries.`);
                                                else console.error('Failed to clear logs: ' + res.error);
                                            }
                                        }
                                    });
                                }}
                                className="w-full py-3 bg-destructive/10 border border-destructive/20 text-destructive hover:bg-destructive hover:text-white font-bold rounded text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all shadow-sm hover:shadow-destructive/20"
                            >
                                <span className="material-symbols-outlined text-sm">delete_forever</span>
                                Clear System Logs
                            </button>
                        </div>

                        {/* Key Management System */}
                        <div className="bg-[#121214] border border-[#27272a] rounded p-6 space-y-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-transparent to-primary/5 pointer-events-none"></div>
                            <div className="flex items-center justify-between border-b border-[#27272a] pb-4">
                                <div>
                                    <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em]">Key Management</h3>
                                    <p className="text-[10px] text-[#71717a] mt-1 font-bold uppercase tracking-wider">Encryption Key Provider</p>
                                </div>
                                <div className={cn("px-2 py-1 rounded border text-[9px] font-bold uppercase tracking-widest", kmsConfig.type === 'vault' ? "bg-primary/10 text-primary border-primary/20" : "bg-[#27272a] text-[#71717a] border-[#3f3f46]")}>
                                    {kmsConfig.type}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="p-3 rounded bg-[#18181b] border border-[#27272a]">
                                    <label className="flex items-center justify-between cursor-pointer group">
                                        <span className="text-[10px] font-bold text-[#71717a] group-hover:text-white uppercase tracking-widest transition-colors">Enable Vault Provider</span>
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={kmsConfig.type === 'vault'}
                                                onChange={(e) => setKmsConfig({ ...kmsConfig, type: e.target.checked ? 'vault' : 'local' })}
                                            />
                                            <div className="w-9 h-5 bg-[#27272a] rounded-full peer peer-checked:bg-primary transition-all"></div>
                                            <div className="absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-all peer-checked:left-5"></div>
                                        </div>
                                    </label>
                                </div>

                                {kmsConfig.type === 'vault' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                        <div className="p-3 bg-primary/10 border border-primary/20 rounded flex items-center gap-3">
                                            <span className="material-symbols-outlined text-primary">security</span>
                                            <div className="flex-1">
                                                <p className="text-[10px] font-bold text-white uppercase tracking-wider">Vault Integration Verified and Secure</p>
                                                <p className="text-[9px] text-[#71717a] mt-0.5">External KMS communication is encrypted and audit-logged.</p>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">Vault Address</label>
                                            <input
                                                type="text"
                                                value={kmsConfig.vault_addr}
                                                onChange={(e) => setKmsConfig({ ...kmsConfig, vault_addr: e.target.value })}
                                                className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:border-primary/50 outline-none"
                                                placeholder="http://127.0.0.1:8200"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">Mount Path</label>
                                            <input
                                                type="text"
                                                value={kmsConfig.mount_path}
                                                onChange={(e) => setKmsConfig({ ...kmsConfig, mount_path: e.target.value })}
                                                className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:border-primary/50 outline-none"
                                                placeholder="secret"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between">
                                                <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">Vault Token</label>
                                                {kmsConfig.vault_token_configured && <span className="text-[9px] text-primary uppercase tracking-wider font-bold">Configured</span>}
                                            </div>
                                            <input
                                                type="password"
                                                value={kmsConfig.vault_token}
                                                onChange={(e) => setKmsConfig({ ...kmsConfig, vault_token: e.target.value })}
                                                className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:border-primary/50 outline-none tracking-[0.2em]"
                                                placeholder={kmsConfig.vault_token_configured ? "••••••••" : "Unset"}
                                            />
                                        </div>
                                    </div>
                                )}

                                {kmsConfig.type === 'local' && (
                                    <div className="pt-4 border-t border-[#27272a]">
                                        <p className="text-[10px] text-[#71717a] mb-4">Rotate the local master key. Existing backups remain readable with their specific keys protected by the previous master key, which is kept in the key history.</p>
                                        <button
                                            onClick={handleRotateKmsKey}
                                            className="w-full py-3 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-white font-bold rounded text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all group"
                                        >
                                            <span className="material-symbols-outlined text-sm text-primary group-hover:rotate-180 transition-transform duration-500">sync</span>
                                            Rotate Local Master Key
                                        </button>
                                    </div>
                                )}

                                <div className="flex justify-end pt-2">
                                    <button
                                        onClick={handleKMSSave}
                                        disabled={kmsLoading}
                                        className={cn(
                                            "px-6 py-2 bg-primary hover:bg-green-400 text-black font-bold rounded text-[10px] uppercase tracking-[0.2em] shadow-[0_4px_12px_rgba(25,230,100,0.2)] transition-all flex items-center gap-2",
                                            kmsLoading && "opacity-50 cursor-not-allowed"
                                        )}
                                    >
                                        <span className="material-symbols-outlined text-sm">save</span>
                                        {kmsLoading ? 'Saving...' : 'Save Configuration'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Performance Tuning */}
                        <div className="bg-[#121214] border border-[#27272a] rounded p-6 space-y-6 relative overflow-hidden">
                            <div className="flex items-center justify-between border-b border-[#27272a] pb-4">
                                <div>
                                    <h3 className="text-xs font-bold text-white uppercase tracking-[0.25em]">Performance Tuning</h3>
                                    <p className="text-[10px] text-[#71717a] mt-1 font-bold uppercase tracking-wider">Streaming Pipeline (Beta)</p>
                                </div>
                                <span className="bg-warning/10 text-warning border border-warning/20 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest">Experimental</span>
                            </div>

                            <div className="space-y-4">
                                <div className="p-3 rounded bg-[#18181b] border border-[#27272a]">
                                    <label className="flex items-center justify-between cursor-pointer group">
                                        <span className="text-[10px] font-bold text-[#71717a] group-hover:text-white uppercase tracking-widest transition-colors">Enable Streaming Backup</span>
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={streamingConfig.enabled}
                                                onChange={(e) => setStreamingConfig({ ...streamingConfig, enabled: e.target.checked })}
                                            />
                                            <div className="w-9 h-5 bg-[#27272a] rounded-full peer peer-checked:bg-primary transition-all"></div>
                                            <div className="absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-all peer-checked:left-5"></div>
                                        </div>
                                    </label>
                                </div>

                                {streamingConfig.enabled && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                                        <div className="space-y-2">
                                            <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">Max Queue Size (GB)</label>
                                            <input
                                                type="number"
                                                value={streamingConfig.max_queue_size_gb}
                                                onChange={(e) => setStreamingConfig({ ...streamingConfig, max_queue_size_gb: Number(e.target.value) })}
                                                className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:border-primary/50 outline-none"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[9px] font-bold text-[#71717a] uppercase tracking-widest px-1">Producer Threads</label>
                                            <input
                                                type="number"
                                                value={streamingConfig.producer_threads}
                                                onChange={(e) => setStreamingConfig({ ...streamingConfig, producer_threads: Number(e.target.value) })}
                                                className="w-full bg-black/40 border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:border-primary/50 outline-none"
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="flex justify-end pt-2">
                                    <button
                                        onClick={handleStreamingSave}
                                        disabled={streamingLoading}
                                        className={cn(
                                            "px-6 py-2 bg-primary hover:bg-green-400 text-black font-bold rounded text-[10px] uppercase tracking-[0.2em] shadow-[0_4px_12px_rgba(25,230,100,0.2)] transition-all flex items-center gap-2",
                                            streamingLoading && "opacity-50 cursor-not-allowed"
                                        )}
                                    >
                                        <span className="material-symbols-outlined text-sm">save</span>
                                        {streamingLoading ? 'Saving...' : 'Save Settings'}
                                    </button>
                                </div>
                            </div>
                        </div>

                    </div>
                )
            }

            {/* Modal: Create User */}
            <AddUserModal
                isOpen={showUserModal}
                onClose={() => setShowUserModal(false)}
                onSuccess={() => {
                    // In real app, we would refresh the users list here
                    if (isDemoMode) {
                        // Just show a notification or update mock state
                        console.log('User created in demo mode')
                    }
                }}
            />

            {/* Modal: Catalog Export */}
            <CatalogExportModal
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
                tapes={tapes}
            />
            {/* Modal: Add Source */}
            <AddSourceModal
                isOpen={showSourceModal}
                onClose={() => setShowSourceModal(false)}
                onSuccess={() => {
                    fetchSources();
                }}
            />

            {/* Reusable Confirmation Modal */}
            <ConfirmationModal
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                variant={confirmModal.variant}
                confirmText={(confirmModal as any).confirmText}
            />
        </div>
    );
}
