import React, { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { useDemoMode } from "@/lib/demoMode"
import { api, Job, Tape } from "@/lib/api"
import CreateJobWizard from "@/components/CreateJobWizard"
import { ContextPanel } from "@/components/ContextPanel"
import ConfirmationModal from "@/components/ui/ConfirmationModal"
import { CassetteTape } from "lucide-react"

const MOCK_JOBS = [
    { id: 8821, name: 'Archive_Project_X', type: 'backup' as const, status: 'running' as const, progress: 45, created_at: new Date().toISOString(), used: '1.2 TB', total: '2.8 TB', duration: '00:14:22', source: '/mnt/.../production', dest: '/dev/st0', tapes: ['A00124L8'] },
    { id: 8820, name: 'Restore_Alpha', type: 'restore' as const, status: 'completed' as const, progress: 100, created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), used: '2.4 TB', total: '2.4 TB', duration: '04:12:05', source: '/dev/st0', dest: '/mnt/.../alpha', tapes: ['A00125L8', 'B00451L7'] },
    { id: 8819, name: 'TapeOps_Cleanup', type: 'backup' as const, status: 'failed' as const, progress: 12, created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), used: '0.3 TB', total: '2.5 TB', duration: '00:02:45', source: 'System', dest: 'Library', error: 'Hardware Timeout', tapes: [] },
    { id: 8822, name: 'Weekly_Backup', type: 'backup' as const, status: 'pending' as const, progress: 0, created_at: 'Scheduled', used: '0 TB', total: '4.2 TB', duration: '--:--:--', source: '/mnt/.../2023', dest: '/dev/st1', tapes: ['C99102L6'] },
];

interface ExtendedJob extends Job {
    used?: string;
    total?: string;
    duration?: string;
    source?: string;
    dest?: string;
    error?: string;
    expanded?: boolean;
}

export default function JobsPage() {
    const { isDemoMode, mockTapes } = useDemoMode();
    const [jobs, setJobs] = useState<ExtendedJob[]>([]);
    const [loading, setLoading] = useState(!isDemoMode);
    const [error, setError] = useState<string | null>(null);
    const [cancellingJobId, setCancellingJobId] = useState<number | null>(null);
    const [showCreateWizard, setShowCreateWizard] = useState(false);
    const [jobLogs, setJobLogs] = useState<Record<number, string[]>>({});
    const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'history'>('running');

    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        jobId: number | null;
    }>({
        isOpen: false,
        jobId: null
    });

    const [tapes, setTapes] = useState<Tape[]>([]);

    const [selectedTapeBarcode, setSelectedTapeBarcode] = useState<string | null>(null);
    const [selectedTape, setSelectedTape] = useState<Tape | null>(null);

    // Fetch tape details when barcode selected
    useEffect(() => {
        if (!selectedTapeBarcode) {
            setSelectedTape(null);
            return;
        }

        const fetchTape = async () => {
            // In a real app we would have an API to get single tape
            // For now, let's just get all tapes and find it, or use mock
            setLoading(true);
            try {
                if (isDemoMode) {
                    // Mock tape fetch
                    setSelectedTape({
                        barcode: selectedTapeBarcode,
                        alias: `Tape_${selectedTapeBarcode}`,
                        status: 'in_use',
                        location_type: 'drive',
                        drive_id: "0",
                        capacity_bytes: 12000000000000,
                        used_bytes: 4500000000000,
                        type: 'LTO-8',
                        mount_count: 5,
                        error_count: 0,
                        trust_status: 'trusted'
                    } as Tape);
                } else {
                    const res = await api.getTapes();
                    if (res.success && res.data) {
                        const found = res.data.tapes.find((t: Tape) => t.barcode === selectedTapeBarcode);
                        if (found) setSelectedTape(found);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch tape details");
            } finally {
                setLoading(false);
            }
        };
        fetchTape();
    }, [selectedTapeBarcode, isDemoMode]);

    useEffect(() => {
        if (isDemoMode) {
            setJobs(MOCK_JOBS.map(j => ({ ...j, expanded: j.id === 8821 })));
            setLoading(false);
            return;
        }

        const fetchJobs = async () => {
            // Don't show full-screen loader on background polls
            const res = await api.getJobs(100);
            if (res.success && res.data) {
                setJobs(prev => {
                    const prevMap = new Map(prev.map(j => [j.id, j]));
                    return res.data!.jobs.map((j: Job) => ({
                        ...j,
                        // Preserve user's expand/collapse choice across polls
                        expanded: prevMap.get(j.id)?.expanded ?? (prev.length === 0 && j === res.data!.jobs[0])
                    }));
                });
                // Refresh logs for jobs that are expanded AND running (live trace)
                const runningExpanded = res.data.jobs.filter((j: Job) =>
                    j.status === 'running' && jobs.find(ej => ej.id === j.id)?.expanded
                );
                for (const j of runningExpanded) {
                    api.getJob(j.id).then(logRes => {
                        if (logRes.success && logRes.data?.logs) {
                            setJobLogs(prev => ({ ...prev, [j.id]: logRes.data!.logs }));
                        }
                    });
                }
            } else if (!jobs.length) {
                setError('Failed to load jobs');
            }
            setLoading(false);
        };

        fetchJobs();
        const interval = setInterval(fetchJobs, 5000);
        return () => clearInterval(interval);
    }, [isDemoMode]);

    useEffect(() => {
        if (isDemoMode) {
            setTapes(mockTapes);
            return;
        }

        const fetchTapes = async () => {
            try {
                const res = await api.getTapes();
                if (res.success && res.data) {
                    setTapes(res.data.tapes);
                }
            } catch (e) {
                console.error("Failed to fetch tapes:", e);
            }
        };

        fetchTapes();
        // Slightly longer interval for tapes as they don't change as rapidly as jobs
        const interval = setInterval(fetchTapes, 15000);
        return () => clearInterval(interval);
    }, [isDemoMode, mockTapes]);

    const toggleExpand = async (id: number) => {
        const isExpanding = !jobs.find(j => j.id === id)?.expanded;
        setJobs(prev => prev.map(job =>
            job.id === id ? { ...job, expanded: !job.expanded } : job
        ));

        if (isExpanding && !isDemoMode) {
            const res = await api.getJob(id);
            if (res.success && res.data && res.data.logs) {
                setJobLogs(prev => ({ ...prev, [id]: res.data!.logs }));
            }
        }
    };

    const handleCancelJob = async (jobId: number, e?: React.MouseEvent) => {
        if (e) e.stopPropagation(); // Prevent row expand toggle

        if (isDemoMode) {
            // Demo mode: simulate cancellation
            setJobs(prev => prev.map(job =>
                job.id === jobId ? { ...job, status: 'cancelled' as const, progress: job.progress } : job
            ));
            return;
        }

        setCancellingJobId(jobId);
        const res = await api.cancelJob(jobId);
        if (res.success) {
            setJobs(prev => prev.map(job =>
                job.id === jobId ? { ...job, status: 'cancelled' as const } : job
            ));
        } else {
            console.error(`Failed to cancel job: ${res.error || 'Unknown error'}`);
        }
        setCancellingJobId(null);
    };


    // Base layout wrapper to keep wizard and panels stable
    return (
        <div className="flex flex-col gap-6">
            {loading ? (
                <div className="flex items-center justify-center h-96">
                    <div className="flex flex-col items-center gap-4">
                        <span className="material-symbols-outlined text-4xl text-primary animate-spin">sync</span>
                        <span className="text-muted-foreground font-mono text-sm uppercase tracking-wider">Loading Jobs...</span>
                    </div>
                </div>
            ) : error && jobs.length === 0 ? (
                <div className="flex items-center justify-center h-96">
                    <div className="flex flex-col items-center gap-4 text-center">
                        <span className="material-symbols-outlined text-4xl text-destructive">error</span>
                        <span className="text-white font-bold">Failed to Load Jobs</span>
                        <span className="text-muted-foreground text-sm">{error}</span>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-4 px-4 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary hover:text-black rounded text-sm font-bold transition-all"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            ) : jobs.length === 0 ? (
                <>
                    <header className="flex items-center justify-between mb-2">
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-white uppercase antialiased">Jobs Management</h1>
                        </div>
                        <button
                            onClick={() => setShowCreateWizard(true)}
                            className="flex items-center gap-2 bg-primary hover:bg-green-400 text-black px-4 py-2 rounded text-[10px] font-bold transition-all shadow-[0_4px_12px_rgba(25,230,100,0.25)] uppercase tracking-widest"
                        >
                            <span className="material-symbols-outlined text-[18px]">add</span>
                            Queue New Job
                        </button>
                    </header>
                    <div className="flex items-center justify-center h-64 border border-[#27272a] rounded bg-[#121214]/50">
                        <div className="text-center">
                            <span className="material-symbols-outlined text-4xl text-muted-foreground mb-2">inbox</span>
                            <p className="text-muted-foreground">No jobs found</p>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    <header className="flex items-center justify-between mb-2">
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-white uppercase antialiased">Jobs Management</h1>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-[#71717a] font-mono uppercase tracking-widest">
                                    {isDemoMode ? 'Demo Mode' : 'Connected to local node'}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowCreateWizard(true)}
                            className="flex items-center gap-2 bg-primary hover:bg-green-400 text-black px-4 py-2 rounded text-[10px] font-bold transition-all shadow-[0_4px_12px_rgba(25,230,100,0.25)] uppercase tracking-widest"
                        >
                            <span className="material-symbols-outlined text-[18px]">add</span>
                            Queue New Job
                        </button>
                    </header>

                    {/* Tabs Row */}
                    <div className="flex items-center border-b border-[#27272a] mb-2 px-1">
                        <button
                            onClick={() => setStatusFilter('running')}
                            className={cn(
                                "px-4 py-3 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-colors",
                                statusFilter === 'running' ? "text-primary border-primary" : "text-[#71717a] hover:text-white border-transparent"
                            )}
                        >
                            Active <span className="ml-2 px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[8px]">{jobs.filter(j => j.status === 'running').length}</span>
                        </button>
                        <button
                            onClick={() => setStatusFilter('all')}
                            className={cn(
                                "px-4 py-3 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-colors",
                                statusFilter === 'all' ? "text-primary border-primary" : "text-[#71717a] hover:text-white border-transparent"
                            )}
                        >
                            All Jobs <span className="ml-2 px-1.5 py-0.5 rounded bg-[#18181b] text-[#71717a] text-[8px]">{jobs.length}</span>
                        </button>
                        <button
                            onClick={() => setStatusFilter('history')}
                            className={cn(
                                "px-4 py-3 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-colors",
                                statusFilter === 'history' ? "text-primary border-primary" : "text-[#71717a] hover:text-white border-transparent"
                            )}
                        >
                            History <span className="ml-2 px-1.5 py-0.5 rounded bg-[#18181b] text-[#71717a] text-[8px]">{jobs.filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled').length}</span>
                        </button>
                    </div>

                    {/* Table Container */}
                    <div className="border border-[#27272a] rounded overflow-hidden bg-[#121214]/50">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-[#18181b] text-[#71717a] uppercase text-[10px] font-bold tracking-[0.15em] border-b border-[#27272a]">
                                <tr>
                                    <th className="px-6 py-4 w-32">Job ID</th>
                                    <th className="px-6 py-4 w-32">Type</th>
                                    <th className="px-6 py-4 w-40">Status</th>
                                    <th className="px-6 py-4 w-64">Progress</th>
                                    <th className="px-6 py-4 w-48">Started At</th>
                                    <th className="px-6 py-4 w-12 text-right"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#27272a] bg-[#09090b]/40">
                                {jobs.filter(job => {
                                    if (statusFilter === 'all') return true;
                                    if (statusFilter === 'running') return job.status === 'running' || job.status === 'pending';
                                    if (statusFilter === 'history') return ['completed', 'failed', 'cancelled'].includes(job.status);
                                    return true;
                                }).map((job) => (
                                    <React.Fragment key={job.id}>
                                        <tr
                                            onClick={() => toggleExpand(job.id)}
                                            className={cn(
                                                "group hover:bg-white/[0.03] transition-colors border-l-2 cursor-pointer",
                                                job.status === 'running' ? "border-l-primary bg-[#18181b]/40" : "border-l-transparent"
                                            )}
                                        >
                                            <td className="px-6 py-4 font-mono text-white font-bold">JOB-{job.id}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 text-white/80">
                                                    <span className={cn(
                                                        "material-symbols-outlined text-[18px]",
                                                        job.status === 'running' ? "text-primary" : "text-[#71717a]"
                                                    )}>
                                                        {job.type === 'backup' ? 'backup' : job.type === 'restore' ? 'settings_backup_restore' : 'manufacturing'}
                                                    </span>
                                                    <span className="text-[10px] font-bold uppercase tracking-wider">{job.type}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={cn(
                                                    "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border",
                                                    job.status === 'running' ? "bg-primary/10 text-primary border-primary/20 shadow-[0_0_8px_rgba(25,230,100,0.1)]" :
                                                        job.status === 'completed' ? "bg-[#18181b] text-[#71717a] border-transparent" :
                                                            job.status === 'failed' ? "bg-destructive/10 text-destructive border-destructive/20" :
                                                                "bg-[#18181b] text-[#71717a] border-transparent opacity-50"
                                                )}>
                                                    {job.status === 'running' && (
                                                        <span className="relative flex h-1.5 w-1.5">
                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
                                                        </span>
                                                    )}
                                                    {job.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex-1 h-1 w-full bg-[#18181b] rounded-full overflow-hidden border border-[#27272a]">
                                                        <div
                                                            className={cn(
                                                                "h-full rounded-full transition-all duration-500",
                                                                job.status === 'running' ? "bg-primary shadow-[0_0_8px_rgba(25,230,100,0.5)]" :
                                                                    job.status === 'failed' ? "bg-destructive" :
                                                                        "bg-[#71717a]"
                                                            )}
                                                            style={{ width: `${job.progress}%` }}
                                                        ></div>
                                                    </div>
                                                    <span className={cn("font-mono text-[10px] font-bold", job.status === 'running' ? "text-primary" : "text-[#71717a]")}>{job.progress}%</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-[#71717a] font-mono text-[10px] uppercase">
                                                {typeof job.created_at === 'string' && job.created_at !== 'Scheduled'
                                                    ? new Date(job.created_at).toLocaleString()
                                                    : job.created_at}
                                            </td>
                                            <td className="px-6 py-4 text-right pr-6">
                                                <span className="material-symbols-outlined text-[#71717a] text-lg transition-transform group-hover:text-white" style={{ transform: job.expanded ? 'rotate(180deg)' : 'none' }}>
                                                    expand_more
                                                </span>
                                            </td>
                                        </tr>
                                        {job.expanded && (
                                            <tr className="bg-[#0c0c0e] border-b border-[#27272a]/50">
                                                <td className="p-0" colSpan={6}>
                                                    <div className="p-6 flex gap-8 animate-in fade-in slide-in-from-top-1 duration-200">
                                                        {/* Terminal Output */}
                                                        <div className="flex-1 flex flex-col gap-3 min-h-[240px]">
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-2 px-1">
                                                                    <span className="material-symbols-outlined text-[#71717a] text-[16px]">terminal</span>
                                                                    <span className="text-[10px] font-bold text-[#71717a] uppercase tracking-[0.2em]">Execution Trace</span>
                                                                    <div className="size-1 rounded-full bg-[#27272a] mx-1"></div>
                                                                    <span className="text-[9px] text-primary/60 font-mono tracking-widest animate-pulse">STREAMING_REALTIME...</span>
                                                                </div>
                                                                <div className="flex items-center gap-4">
                                                                    <button className="text-[9px] text-[#71717a] hover:text-white flex items-center gap-1.5 transition-colors font-bold uppercase tracking-widest">
                                                                        <span className="material-symbols-outlined text-[14px]">download</span>
                                                                        Exp_Log
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="flex-1 bg-black rounded border border-[#27272a] p-4 font-mono text-[10px] text-[#e4e4e7]/80 overflow-y-auto max-h-[220px] custom-scrollbar shadow-inner shadow-black">
                                                                {(jobLogs[job.id] || []).length > 0 ? (
                                                                    jobLogs[job.id].map((log: any, idx: number) => {
                                                                        const msg = typeof log === 'string' ? log : log.message;
                                                                        const time = typeof log === 'string' ? `[${idx}]` : (log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : `[${idx}]`);
                                                                        return (
                                                                            <div key={idx} className="flex gap-4 mb-1">
                                                                                <span className="text-[#3f3f46] select-none shrink-0 tracking-tighter">{time}</span>
                                                                                <span className="text-white/80">{msg}</span>
                                                                            </div>
                                                                        );
                                                                    })
                                                                ) : (
                                                                    <>
                                                                        <div className="flex gap-4 mb-1 opacity-40">
                                                                            <span className="text-[#3f3f46] select-none shrink-0 tracking-tighter">10:00:05.122</span>
                                                                            <span>[SYS] Job initialized: {job.name}</span>
                                                                        </div>
                                                                        <div className="flex gap-4 mb-1 opacity-60">
                                                                            <span className="text-[#3f3f46] select-none shrink-0 tracking-tighter">10:00:12.891</span>
                                                                            <span>[JOB] Status: {job.status.toUpperCase()}</span>
                                                                        </div>
                                                                        <div className="flex gap-4 mb-1">
                                                                            <span className="text-[#3f3f46] select-none shrink-0 tracking-tighter">10:00:15.004</span>
                                                                            <span className="text-white">Progress: {job.progress}%</span>
                                                                        </div>
                                                                    </>
                                                                )}
                                                                <div className="flex gap-2 mt-2">
                                                                    <span className="text-primary animate-pulse select-none font-bold">{" >"}</span>
                                                                    <span className="h-3.5 w-1.5 bg-primary/40 animate-pulse"></span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Middle: Associated Tapes */}
                                                        <div className="w-48 flex flex-col border-l border-[#27272a] pl-8">
                                                            <h3 className="text-[9px] font-bold text-[#71717a] uppercase tracking-[0.2em] mb-3">Resources</h3>
                                                            <div className="flex flex-col gap-2">
                                                                {(job.tapes && job.tapes.length > 0) ? job.tapes.map(barcode => (
                                                                    <button
                                                                        key={barcode}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedTapeBarcode(barcode);
                                                                        }}
                                                                        className="flex items-center gap-2 text-[10px] font-mono p-2 rounded bg-[#18181b] border border-[#27272a] hover:border-primary hover:text-white text-[#a1a1aa] transition-all group/tape"
                                                                    >
                                                                        <CassetteTape className="size-3.5 text-primary/50 group-hover/tape:text-primary" />
                                                                        {barcode}
                                                                    </button>
                                                                )) : (
                                                                    <span className="text-[10px] text-[#71717a] italic">No tapes assigned</span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Metrics & Actions Panel */}
                                                        <div className="w-64 flex flex-col justify-between border-l border-[#27272a] pl-8">
                                                            <div className="space-y-6 pt-2">
                                                                <div>
                                                                    <h3 className="text-[9px] font-bold text-[#71717a] uppercase tracking-[0.2em] mb-2">Job Name</h3>
                                                                    <div className="text-sm font-mono text-white font-bold tracking-tight">{job.name}</div>
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-[9px] font-bold text-[#71717a] uppercase tracking-[0.2em] mb-2">Progress</h3>
                                                                    <div className="text-2xl font-mono text-white font-bold tracking-tighter">{job.progress}<span className="text-xs text-[#71717a] tracking-normal font-normal">%</span></div>
                                                                </div>
                                                            </div>
                                                            <div className="pb-2 flex flex-col gap-3">
                                                                {job.job_type !== 'tape_wipe' && job.type !== 'tape_wipe' && job.job_type !== 'tape_format' && job.type !== 'tape_format' && (
                                                                    <>
                                                                        <button className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded bg-[#18181b] border border-[#27272a] text-[#71717a] hover:text-white transition-all text-[9px] font-bold uppercase tracking-widest">
                                                                            <span className="material-symbols-outlined text-[16px]">pause</span>
                                                                            Pause_Job
                                                                        </button>
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setConfirmModal({ isOpen: true, jobId: job.id });
                                                                            }}
                                                                            disabled={cancellingJobId === job.id || job.status === 'cancelled' || job.status === 'completed' || job.status === 'failed'}
                                                                            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded border border-destructive/30 text-destructive hover:bg-destructive hover:text-black transition-all text-[9px] font-bold uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-destructive"
                                                                        >
                                                                            <span className="material-symbols-outlined text-[16px]">{cancellingJobId === job.id ? 'sync' : 'cancel'}</span>
                                                                            {cancellingJobId === job.id ? 'Aborting...' : 'Abort_Job'}
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination / Footer */}
                    <div className="flex items-center justify-between mt-2 text-[10px] text-[#71717a] font-mono uppercase tracking-widest px-1">
                        <div>Showing 1-{jobs.length} of {jobs.length} entries</div>
                        <div className="flex gap-2">
                            <button className="px-3 py-1.5 rounded bg-[#121214] border border-[#27272a] hover:bg-[#18181b] hover:text-white disabled:opacity-30 transition-all font-bold" disabled>Prev</button>
                            <button className="px-3 py-1.5 rounded bg-[#121214] border border-[#27272a] hover:bg-[#18181b] hover:text-white transition-all font-bold">Next</button>
                        </div>
                    </div>
                </>
            )}

            {/* Create Job Wizard Modal - Stable outside conditions */}
            <CreateJobWizard
                isOpen={showCreateWizard}
                tapes={tapes}
                onClose={() => setShowCreateWizard(false)}
                onSuccess={() => {
                    // Refresh jobs list after creating
                    if (!isDemoMode) {
                        api.getJobs().then(res => {
                            if (res.success && res.data) {
                                setJobs(res.data.jobs.map((j: Job) => ({ ...j, expanded: false })));
                            }
                        });
                    }
                }}
            />

            <ConfirmationModal
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal({ isOpen: false, jobId: null })}
                onConfirm={() => confirmModal.jobId && handleCancelJob(confirmModal.jobId)}
                title="Abort Job"
                message="Are you sure you want to abort this job? This operation cannot be reversed and may leave the system in an intermediate state."
                variant="danger"
                confirmText="Abort Job"
            />

            {/* Tape Context Panel */}
            <ContextPanel
                tape={selectedTape}
                isOpen={!!selectedTape}
                onClose={() => setSelectedTapeBarcode(null)}
                showViewAction={true}
            />
        </div>
    );
}
