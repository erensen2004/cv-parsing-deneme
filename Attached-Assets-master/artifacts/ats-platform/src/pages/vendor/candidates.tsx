import { useState, useRef } from "react";
import { useListCandidates, useSubmitCandidate, useListRoles } from "@workspace/api-client-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserCircle, Loader2, Plus, FileText, Upload, Tag, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListCandidatesQueryKey } from "@workspace/api-client-react";

export default function VendorCandidates() {
  const { data: candidates, isLoading } = useListCandidates();
  const { data: roles } = useListRoles();
  const [isOpen, setIsOpen] = useState(false);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [tags, setTags] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const publishedRoles = roles?.filter(r => r.status === 'published') || [];

  const [formData, setFormData] = useState({
    firstName: "", lastName: "", email: "", phone: "", expectedSalary: "", roleId: ""
  });

  const { mutate: submit, isPending } = useSubmitCandidate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
        setIsOpen(false);
        setFormData({ firstName: "", lastName: "", email: "", phone: "", expectedSalary: "", roleId: "" });
        setTags("");
        setCvFile(null);
        toast({ title: "Candidate submitted successfully!" });
      },
      onError: (err: any) => {
        toast({
          title: "Submission failed",
          description: err?.message || "This candidate may already be submitted for this role.",
          variant: "destructive"
        });
      }
    }
  });

  const uploadCv = async (file: File): Promise<string | null> => {
    try {
      const token = localStorage.getItem("ats_token");
      const res = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) return null;
      const { uploadURL, objectPath } = await res.json();
      await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });

      await fetch("/api/storage/uploads/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ objectPath }),
      });

      return objectPath;
    } catch {
      return null;
    }
  };

  const parsePdfCv = async (file: File): Promise<void> => {
    if (!file.type.includes("pdf")) {
      toast({ title: "Please select a PDF file", variant: "destructive" });
      return;
    }

    setParsing(true);
    try {
      const token = localStorage.getItem("ats_token");
      const res = await fetch("/api/cv-parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" },
        body: file,
      });
      if (!res.ok) {
        toast({ title: "CV parsing failed", description: "You can still fill in the fields manually.", variant: "destructive" });
        return;
      }

      const parsed = await res.json();
      setFormData(prev => ({
        ...prev,
        firstName: parsed.firstName || prev.firstName,
        lastName: parsed.lastName || prev.lastName,
        email: parsed.email || prev.email,
        phone: parsed.phone || prev.phone,
        expectedSalary: parsed.expectedSalary ? String(parsed.expectedSalary) : prev.expectedSalary,
      }));
      if (parsed.skills) {
        setTags(parsed.skills);
      }
      toast({ title: "CV parsed successfully", description: "Candidate fields were auto-filled from the uploaded PDF." });
    } catch {
      toast({ title: "CV parsing error", description: "You can still complete the form manually.", variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.roleId) {
      toast({ title: "Please select a position", variant: "destructive" });
      return;
    }
    setUploading(true);
    let cvUrl: string | undefined;
    if (cvFile) {
      const objectPath = await uploadCv(cvFile);
      if (objectPath) cvUrl = objectPath;
    }
    setUploading(false);
    submit({
      data: {
        ...formData,
        roleId: Number(formData.roleId),
        expectedSalary: formData.expectedSalary ? Number(formData.expectedSalary) : undefined,
        cvUrl,
        tags: tags || undefined,
      }
    });
  };

  return (
    <DashboardLayout allowedRoles={["vendor"]}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">My Candidates</h1>
          <p className="text-slate-500 mt-1">Track the pipeline status of candidates you submitted</p>
        </div>
        <Button className="rounded-xl shadow-md h-11 px-6" onClick={() => setIsOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Candidate
        </Button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Candidate</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Role Applied</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Tags</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Salary Req.</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">CV</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={6} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></td></tr>
              ) : candidates?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center">
                    <UserCircle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500 font-medium">No candidates yet</p>
                    <p className="text-sm text-slate-400 mt-1">Click "Add Candidate" to submit your first candidate</p>
                  </td>
                </tr>
              ) : candidates?.map(c => {
                const tags = c.tags ? c.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
                return (
                <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0 text-orange-600">
                        <UserCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{c.firstName} {c.lastName}</div>
                        <div className="text-sm text-slate-500">{c.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-700">{c.roleTitle}</td>
                  <td className="px-6 py-4">
                    {tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {tags.slice(0, 2).map((tag, i) => (
                          <span key={i} className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">{tag}</span>
                        ))}
                        {tags.length > 2 && <span className="text-xs text-slate-400">+{tags.length - 2}</span>}
                      </div>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-6 py-4 text-slate-600">{c.expectedSalary ? formatCurrency(c.expectedSalary) : '-'}</td>
                  <td className="px-6 py-4">
                    {c.cvUrl ? (
                      <a
                        href={`/api/storage${c.cvUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        <FileText className="w-4 h-4" /> View CV
                      </a>
                    ) : (
                      <span className="text-slate-400 text-sm">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                  <td className="px-6 py-4 text-sm text-slate-600">{format(new Date(c.submittedAt), 'MMM d, yyyy')}</td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>Add Candidate</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Open Position</label>
              <Select required value={formData.roleId} onValueChange={v => setFormData({ ...formData, roleId: v })}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Select a position" />
                </SelectTrigger>
                <SelectContent>
                  {publishedRoles.length === 0 ? (
                    <SelectItem value="none" disabled>No open positions available</SelectItem>
                  ) : publishedRoles.map(r => (
                    <SelectItem key={r.id} value={r.id.toString()}>{r.title} — {r.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">First Name</label>
                <Input required value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Last Name</label>
                <Input required value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} className="h-11 rounded-xl" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Email Address</label>
              <Input type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="h-11 rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Phone</label>
                <Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="h-11 rounded-xl" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Expected Salary ($)</label>
                <Input type="number" value={formData.expectedSalary} onChange={e => setFormData({ ...formData, expectedSalary: e.target.value })} className="h-11 rounded-xl" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold flex items-center gap-2">
                <Tag className="w-4 h-4 text-slate-400" />
                Tags / Skills
              </label>
              <Input value={tags} onChange={e => setTags(e.target.value)} placeholder="React, TypeScript, Node.js" className="h-11 rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">CV / Resume (PDF)</label>
              <div
                className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0] || null;
                    setCvFile(file);
                    if (file) {
                      await parsePdfCv(file);
                    }
                  }}
                />
                {cvFile ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
                      <FileText className="w-4 h-4" /> {cvFile.name}
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700">
                      {parsing ? <><Loader2 className="w-3 h-3 animate-spin" />Parsing CV and auto-filling form...</> : <><Sparkles className="w-3 h-3" />PDF uploaded. Fields auto-fill automatically.</>}
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-400 text-sm">
                    <Upload className="w-5 h-5 mx-auto mb-1" />
                    Click to upload PDF and auto-fill candidate fields
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)} className="flex-1 h-11 rounded-xl">Cancel</Button>
              <Button type="submit" disabled={isPending || uploading} className="flex-1 h-11 rounded-xl">
                {(isPending || uploading) ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit Candidate"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
