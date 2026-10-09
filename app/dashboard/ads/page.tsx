"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Copy, ImagePlus, Megaphone, Receipt, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useProfile } from "@/lib/useProfile"
import { normalizeDigits } from "@/components/store/store-context"
import { Header } from "@/components/dashboard/header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AD_STATUS, AD_TYPE_LABEL, DELETABLE_STATUSES } from "@/lib/ad-templates"
import {
  AdComposer,
  errText,
  pickImage,
  type CreatedCampaign,
  type MyProduct,
  type Pkg,
  type Tpl,
} from "@/components/dashboard/ad-composer"

type Ad = {
  id: string
  type: string
  title: string
  status: string
  price: number
  total_budget: number
  is_free: boolean
  duration_days: number
  target_province: string | null
  target_category: string | null
  review_note: string | null
  refund_status: string | null
}
type Cat = { id: string; name: string }
type PayInfo = { card: string; holder: string; iban: string; ibanHolder: string; note: string }
type PaymentMethod = "card" | "iban"

const formatUSD = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount)

export default function AdsPage() {
  const { user, loading } = useProfile()
  const uid = user?.id

  const [ads, setAds] = useState<Ad[]>([])
  const [pkgs, setPkgs] = useState<Pkg[]>([])
  const [tpls, setTpls] = useState<Tpl[]>([])
  const [products, setProducts] = useState<MyProduct[]>([])
  const [cats, setCats] = useState<Cat[]>([])
  const [payInfo, setPayInfo] = useState<PayInfo>({ card: "", holder: "", iban: "", ibanHolder: "", note: "" })
  const [storeName, setStoreName] = useState("")
  const [storeAvatar, setStoreAvatar] = useState<string | null>(null)
  const [fetching, setFetching] = useState(true)

  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [focusedCampaignId, setFocusedCampaignId] = useState<string | null>(null)

  const [pay, setPay] = useState<{ id: string; price: number } | null>(null)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [payRef, setPayRef] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card")
  const receiptRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!uid) return
    const [c, pk, tp, p, k, s, me] = await Promise.all([
      supabase
        .from("campaigns")
        .select("id, type, title, status, price, total_budget, is_free, duration_days, target_province, target_category, review_note, refund_status")
        .eq("merchant_id", uid)
        .order("created_at", { ascending: false }),
      supabase.from("ad_packages").select("id, label, days, daily_price, features, is_recommended").eq("active", true).order("sort"),
      supabase.from("ad_templates").select("type, title, description").eq("enabled", true).order("sort"),
      supabase.from("products").select("id, title, cover_url, price").eq("merchant_id", uid),
      supabase.from("categories").select("id, name").order("sort"),
      supabase
        .from("platform_settings")
        .select("key, value")
        .in("key", ["payment_card_number", "payment_card_holder", "payment_iban", "payment_iban_holder", "payment_note"]),
      supabase.from("profiles").select("store_name, full_name, avatar_url").eq("id", uid).maybeSingle(),
    ])
    setAds((c.data ?? []) as Ad[])
    setPkgs((pk.data ?? []) as Pkg[])
    setTpls((tp.data ?? []) as Tpl[])
    setProducts((p.data ?? []) as MyProduct[])
    setCats((k.data ?? []) as Cat[])
    const cfg: Record<string, string> = {}
    for (const r of (s.data ?? []) as { key: string; value: string }[]) cfg[r.key] = r.value ?? ""
    setPayInfo({
      card: cfg.payment_card_number ?? "",
      holder: cfg.payment_card_holder ?? "",
      iban: cfg.payment_iban ?? "",
      ibanHolder: cfg.payment_iban_holder ?? "",
      note: cfg.payment_note ?? "",
    })
    const prof = me.data as { store_name?: string | null; full_name?: string | null; avatar_url?: string | null } | null
    setStoreName(prof?.store_name ?? prof?.full_name ?? "")
    setStoreAvatar(prof?.avatar_url ?? null)
    setFetching(false)
  }, [uid])

  useEffect(() => {
    if (loading) return
    if (!uid) {
      setFetching(false)
      return
    }
    void load()
  }, [loading, uid, load])

  useEffect(() => {
    if (fetching || typeof window === "undefined") return
    const campaignId = new URLSearchParams(window.location.search).get("campaign")
    if (!campaignId || !ads.some((ad) => ad.id === campaignId)) return
    setFocusedCampaignId(campaignId)
    document.getElementById(`campaign-${campaignId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [ads, fetching])

  function closePay() {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview)
    setPay(null)
    setReceipt(null)
    setReceiptPreview(null)
    setPayRef("")
  }

  function openPayment(id: string, price: number) {
    setPay({ id, price })
    setPaymentMethod(payInfo.card ? "card" : "iban")
  }

  async function handleCreated(row: CreatedCampaign) {
    setCreating(false)
    await load()
    if (row.status === "pending_payment") {
      setPay({ id: row.id, price: row.price })
      toast.info("أرسل إيصال الدفع لتبدأ مراجعة إعلانك")
    } else {
      toast.success("تم إرسال إعلانك للإدارة، وهو قيد المراجعة")
    }
  }

  async function submitPayment() {
    if (!uid || !pay) return
    if (!receipt) return toast.error("أرفق صورة الإيصال")
    if ((paymentMethod === "card" && !payInfo.card) || (paymentMethod === "iban" && !payInfo.iban)) {
      return toast.error("وجهة التحويل المختارة غير متاحة")
    }
    const paymentReference = normalizeDigits(payRef).trim()
    if (paymentReference.length < 6) return toast.error("اكتب رقم العملية")
    setBusy(true)
    try {
      const ext = (receipt.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg"
      const path = `${uid}/${pay.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from("receipts").upload(path, receipt, { contentType: receipt.type })
      if (upErr) throw upErr
      const { error } = await supabase.rpc("submit_campaign_payment", {
        p_campaign_id: pay.id,
        p_receipt_path: path,
        p_payment_ref: paymentReference,
        p_payment_method: paymentMethod,
      })
      if (error) throw error
      toast.success("تم إرسال الإيصال، وأصبح إعلانك قيد مراجعة الإدارة")
      closePay()
      await load()
    } catch (e) {
      console.error(e)
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    const id = deleteId
    setDeleteId(null)
    if (!id) return
    const { error } = await supabase.from("campaigns").delete().eq("id", id)
    if (error) return toast.error("تعذّر حذف الإعلان")
    toast.success("تم حذف الإعلان")
    setAds((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div className="flex flex-col gap-6">
      <Header
        title="الإعلانات"
        description="روّج لمنتجاتك ومتجرك للوصول لزبائن أكثر"
        search={false}
        actions={
          !creating ? (
            <Button onClick={() => setCreating(true)} className="h-11 rounded-full px-6">
              + إعلان جديد
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-l from-emerald-50 to-white p-4 sm:p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <Megaphone className="size-5" />
        </span>
        <div>
          <p className="font-bold text-emerald-950">الدفع بتحويل يدوي آمن</p>
          <p className="mt-1 text-sm leading-6 text-emerald-800">
            اختر باقة بالدولار، حوّل إلى البطاقة المحلية أو IBAN، ثم أرسل الإيصال ورقم العملية. يراجع الأدمن التحويل قبل تفعيل الإعلان.
          </p>
        </div>
      </div>

      {creating && uid && (
        <AdComposer
          uid={uid}
          storeName={storeName}
          storeAvatar={storeAvatar}
          tpls={tpls}
          pkgs={pkgs}
          products={products}
          onCancel={() => setCreating(false)}
          onCreated={handleCreated}
        />
      )}

      {fetching ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : ads.length === 0 && !creating ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          ما عندك إعلانات بعد. اضغط "إعلان جديد" وابدأ.
        </div>
      ) : (
        <div className="max-w-3xl space-y-3">
          {ads.map((c) => {
            const st = AD_STATUS[c.status] ?? { label: c.status, cls: "bg-secondary text-muted-foreground" }
            const catName = cats.find((k) => k.id === c.target_category)?.name
            return (
              <div
                key={c.id}
                id={`campaign-${c.id}`}
                className={`rounded-xl border bg-card p-4 transition-colors ${
                  focusedCampaignId === c.id ? "border-primary ring-2 ring-primary/30" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{AD_TYPE_LABEL[c.type] ?? c.type}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{c.duration_days} أيام</span>
                  <span>{c.is_free ? "مجاني" : formatUSD(c.price || c.total_budget)}</span>
                  <span>{c.target_province ?? "حسب متجرك"}</span>
                  {catName && <span>{catName}</span>}
                </div>
                {c.status === "pending_review" && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    الإعلان قيد مراجعة الإدارة، ولن يظهر للعملاء حتى تتم الموافقة عليه.
                  </p>
                )}
                {c.review_note && (c.status === "rejected" || c.status === "pending_payment") && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">ملاحظة الإدارة: {c.review_note}</p>
                )}
                {c.status === "rejected" && c.refund_status === "pending" && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    الإعلان مرفوض. تتم إعادة المبلغ يدويًا، وسيظهر تحديث هنا بعد تأكيد الإدارة.
                  </p>
                )}
                {c.status === "rejected" && c.refund_status === "refunded" && (
                  <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    أكدت الإدارة إعادة المبلغ يدويًا.
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between gap-2">
                  {c.status === "pending_payment" && !c.is_free ? (
                    <Button size="sm" onClick={() => openPayment(c.id, c.price || c.total_budget)} className="h-8 gap-1.5 text-xs">
                      <Receipt className="h-3.5 w-3.5" />
                      ادفع وأرسل الإيصال
                    </Button>
                  ) : (
                    <span />
                  )}
                  {DELETABLE_STATUSES.includes(c.status) && (
                    <button type="button" onClick={() => setDeleteId(c.id)} className="flex items-center gap-1 text-xs text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                      حذف
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={pay !== null} onOpenChange={(o) => { if (!o && !busy) closePay() }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader className="text-right">
            <DialogTitle>دفع قيمة الإعلان</DialogTitle>
            <DialogDescription>حوّل المبلغ بالدولار إلى إحدى الوجهتين، ثم أرسل صورة الإيصال ورقم العملية. سيبقى الإعلان قيد المراجعة حتى يتحقق الأدمن من وصول المبلغ.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
              <span className="text-muted-foreground">المبلغ المطلوب</span>
              <span className="font-bold">{formatUSD(pay?.price ?? 0)}</span>
            </div>
            {(payInfo.card || payInfo.iban) && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {payInfo.card && (
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("card")}
                      className={`rounded-xl border p-2 text-xs font-semibold ${paymentMethod === "card" ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      بطاقة / حساب محلي
                    </button>
                  )}
                  {payInfo.iban && (
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("iban")}
                      className={`rounded-xl border p-2 text-xs font-semibold ${paymentMethod === "iban" ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      IBAN دولي
                    </button>
                  )}
                </div>
                    <div className="space-y-1.5 rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span dir="ltr" className="break-all font-mono text-base tracking-wider">
                          {paymentMethod === "card" ? payInfo.card : payInfo.iban}
                        </span>
                        <button
                          type="button"
                          aria-label="نسخ"
                          onClick={() => {
                            const destination = paymentMethod === "card" ? payInfo.card : payInfo.iban
                            void navigator.clipboard.writeText(destination).then(
                              () => toast.success("تم نسخ بيانات التحويل"),
                              () => toast.error("تعذّر النسخ، انسخ البيانات يدويًا"),
                            )
                          }}
                          className="rounded-full p-2 hover:bg-secondary"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                      {(paymentMethod === "card" ? payInfo.holder : payInfo.ibanHolder) && (
                        <p className="text-xs text-muted-foreground">
                          باسم: {paymentMethod === "card" ? payInfo.holder : payInfo.ibanHolder}
                        </p>
                      )}
                      {payInfo.note && <p className="text-xs text-muted-foreground">{payInfo.note}</p>}
                    </div>
              </>
            )}
            {!payInfo.card && !payInfo.iban && (
              <p className="rounded-xl border border-border p-3 text-xs text-muted-foreground">لم تُضبط بيانات التحويل بعد. لا ترسل أي مبلغ؛ تواصل مع الدعم.</p>
            )}
            <div className="space-y-1.5">
              <Label>صورة الإيصال</Label>
              <button
                type="button"
                onClick={() => receiptRef.current?.click()}
                className="flex h-32 w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border hover:bg-secondary"
              >
                {receiptPreview ? (
                  <img src={receiptPreview} alt="" className="h-full w-full object-contain" />
                ) : (
                  <ImagePlus className="h-7 w-7 text-muted-foreground" />
                )}
              </button>
              <input
                ref={receiptRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = pickImage(e, 5 * 1024 * 1024)
                  if (!f) return
                  if (receiptPreview) URL.revokeObjectURL(receiptPreview)
                  setReceipt(f)
                  setReceiptPreview(URL.createObjectURL(f))
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">رقم العملية</Label>
              <Input
                id="pay-ref"
                dir="ltr"
                value={payRef}
                onChange={(e) => setPayRef(normalizeDigits(e.target.value).slice(0, 40))}
                placeholder="مثال: 123456789"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closePay} disabled={busy} className="bg-transparent">
              لاحقاً
            </Button>
            <Button onClick={submitPayment} disabled={busy}>
              {busy ? "جارٍ الإرسال..." : "إرسال الإيصال"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader className="text-right">
            <DialogTitle>حذف الإعلان</DialogTitle>
            <DialogDescription>سيتم حذف هذا الإعلان نهائياً. هل تريد المتابعة؟</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteId(null)} className="bg-transparent">
              إلغاء
            </Button>
            <Button onClick={confirmDelete} className="bg-red-600 text-white hover:bg-red-700">
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
