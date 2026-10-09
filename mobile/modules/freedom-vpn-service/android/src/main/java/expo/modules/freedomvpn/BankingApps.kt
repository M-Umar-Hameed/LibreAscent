package expo.modules.freedomvpn

import android.content.Context
import android.content.Intent

/**
 * Banking and wallet apps. They refuse to run behind a VPN or alongside an
 * accessibility service, so the tunnel bypasses them and the accessibility
 * service steps aside while one is in front.
 *
 * ponytail: a known list plus a name match on "bank" for apps installed from
 * Play; an app outside both needs adding to KNOWN.
 */
object BankingApps {
    // Verified against Google Play, 2026-10.
    internal val KNOWN = setOf(
        // India
        "com.phonepe.app", "com.phonepe.app.business", "net.one97.paytm", "com.paytm.business",
        "in.org.npci.upiapp", "com.sbi.lotusintouch", "com.sbi.SBIFreedomPlus", "com.sbi.upi",
        "com.hdfcbank.payzapp", "com.csam.icici.bank.imobile", "com.icicibank.pockets", "com.axis.mobile",
        "com.kotak811mobilebankingapp.instantsavingsupiscanandpayrecharge", "com.msf.kbank.mobile",
        "com.bankofbaroda.mconnect", "com.bankofbaroda.upi", "com.Version1", "com.infrasoft.uboi",
        "com.canarabank.mobility", "com.boi.ua.android", "com.lcode.ucomobilebanking", "com.snapwork.IDBI",
        "com.idfcfirstbank.optimus", "com.indusind.indie", "com.mgs.induspsp", "com.fedmobile",
        "com.rblbank.mobank", "com.sib.retail", "com.kvb.mobilebanking", "com.dbs.in.digitalbank",
        "com.mobikwik_new", "com.freecharge.android", "com.dreamplug.androidapp", "money.jupiter",
        "com.naviapp", "money.super.payments", "indwin.c3.shareapp", "org.altruist.BajajExperia",
        // Global
        "com.google.android.apps.nbu.paisa.user", "com.moneybookers.skrillpayments", "com.venmo",
        "com.squareup.cash", "com.samsung.android.spay", "com.westernunion.android.mtapp",
        "com.gpshopper.moneygram", "com.remitly.androidapp", "com.payoneer.android",
        "com.moneybookers.skrillpayments.neteller", "com.worldremit.android", "com.xoom.android.app",
        "com.mgi.moneygram", "com.ria.moneytransfer", "com.taptapsend", "at.paysafecard.android",
        // GB
        "com.barclays.android.barclaysmobilebanking", "com.barclays.bca", "uk.co.hsbc.hsbcukmobilebanking",
        "uk.co.hsbc.hsbcukbusinessbanking", "com.firstdirect.bankingonthego",
        "com.grppl.android.shell.CMBlloydsTSB73", "com.lloydsbank.businessmobile",
        "com.grppl.android.shell.halifax", "com.grppl.android.shell.BOS", "uk.co.bankofscotland.businessbank",
        "com.rbs.mobile.android.natwest", "com.rbs.banklinemobile.natwest", "com.rbs.mobile.android.rbs",
        "com.rbs.mobile.android.ubn", "uk.co.mettle.app", "uk.co.santander.santanderUK",
        "uk.co.santander.businessbankingUK", "uk.co.tsb.newmobilebank", "uk.co.tsb.businessmobilebank",
        "co.uk.Nationwide.Mobile", "com.virginmoney.uk.mobile.android", "com.virginmoney.cards",
        "com.cooperativebank.bank", "com.co_operative_bank.sme_mobile_banking",
        "uk.co.metrobankonline.mobile.android.production", "co.uk.getmondo", "com.starlingbank.android",
        "com.revolut.business", "com.chase.intl", "com.bsocial", "com.zopa.zeos", "com.atombank.release",
        "com.tideplatform.banking", "bank.allica.businessbanking", "com.anna.money.app",
        "co.uk.mycashplus.maapp", "com.monese.monese.live", "com.cbs.prod", "uk.co.ybs.savings.external",
        "com.skipton.online", "com.mns.mnsuk.android", "com.tescobank.mobile",
        "com.danskebank.mobilebank3.uk", "com.triodos.bankinguk", "com.americanexpress.android.acctsvcs.uk",
        "com.ie.capitalone.uk", "com.vanquis.app", "com.imaginecurve.curve.prd", "boi.co.uk",
        // EU
        "com.revolut.revolut", "com.transferwise.android", "com.paypal.android.p2pmobile",
        "com.google.android.apps.walletnfcrel", "com.myklarnamobile",
        // Ireland
        "com.bankofireland.mobilebanking", "aib.ibank.android",
        // IE
        "com.nearform.ptsb", "com.anpost.eco.apm",
        // Netherlands
        "com.bunq.android", "com.ing.mobile", "com.abnamro.nl.mobile.payments", "nl.rabomobiel",
        "com.abnamro.nl.tikkie",
        // Germany
        "de.number26.android", "com.starfinanz.smob.android.sfinanzstatus", "de.commerzbanking.mobil",
        "com.db.pwcc.dbmobile", "de.fiduciagad.banking.vr", "com.dkbcodefactory.banking",
        "de.ingdiba.bankingapp", "de.postbank.banking", "de.comdirect.app", "de.consorsbank",
        // UAE
        "com.emiratesnbd.android", "com.fab.personalbanking", "com.adcb.bank", "com.adcb.bank.app",
        "com.adib.mobile", "com.vipera.ts.starter.MashreqAE", "com.dib.app", "com.rak",
        "com.emiratesislamic.android", "me.livx.android", "io.wio.retail", "com.ruya.bank",
        "com.etisalat.ewallet", "com.payit.wallet", "com.ziina.app", "com.eitcfs.dupay",
        // Saudi Arabia
        "com.alrajhiretailapp", "com.snb.alahlimobile", "com.riyadbank.digitalmobile",
        "com.alinma.retail.mobile.v4", "com.alinma.pay.consumer", "com.sabb.mobilebanking",
        "com.saib.mobile.retail", "com.bankalbilad.NewRMB", "com.urpay.consumer",
        // Qatar
        "com.vipera.ts.starter.QNB", "com.pozitron.qib", "com.cbq.CBMobile", "com.QIIB",
        // Kuwait
        "eu.eleader.mobilebanking.nbk", "com.nbk.weyay", "com.kfh.kfhonline", "com.boubyanapp.boubyan.bank",
        "com.ofss.gbkprodret",
        // Bahrain
        "mobi.foo.benefit", "com.nbb.mbbanking.sepa.master", "com.bbkonline.bbkdigital",
        "com.bankabc.ilabank", "com.vivacash.sadad",
        // Oman
        "com.ducont.muscatbank", "com.BankSoharMB",
        // Egypt
        "com.egyptianbanks.instapay", "com.ofss.obdx.and.nbe.com.eg", "com.emeint.android.mwallet",
        "com.cibeg.ddc1.digitalbanking.live", "com.BanqueMisr.MobileBanking", "com.fawry.myfawry",
        "eg.com.qnb.eazymobile", "com.bdc.eg.mobile", "com.emeint.android.myservices", "com.etisalat.flous",
        "com.isic.valu", "io.telda.app", "com.halanuser",
        // Jordan
        "com.arabbank.arabiplc", "com.hbtf",
        // Turkey
        "com.ziraat.ziraatmobil", "com.garanti.cepsubesi", "com.pozitron.iscep",
        "com.akbank.android.apps.akbank_direkt", "com.ykb.android", "com.vakifbank.mobile",
        "com.tmobtech.halkbank", "com.finansbank.mobile.cepsube", "com.denizbank.mobildeniz", "com.teb",
        "com.ingbanktr.ingmobil", "com.kuveytturk.mobil", "com.enparabank.retail", "com.mobillium.papara",
        // Pakistan
        "pk.com.telenor.phoenix", "com.techlogix.mobilinkcustomer", "com.ibm.jazzcashmerchant",
        "com.sadapay.app", "com.nayapay.app", "pk.upaisa.com", "com.wallet.zindigi", "ws.krlp",
        "invo8.meezan.mb", "com.roshandigital", "com.hbl.android.hblmobilebanking", "com.mcb.mcblive",
        "app.com.brd", "com.base.bankalfalah", "com.ofss.digx.mobile.android.allied", "com.finja.abl.wallet",
        "com.avanza.ambitwizfbl", "com.ofss.digx.mobile.obdx.bahl", "com.alhabib.digitalapp", "com.askari",
        "com.JSBL.bank", "com.scb.pk.bmw", "com.paysys.nbpdigital", "com.bi.digitalbanking",
        "com.wallet.bankislami", "com.avanza.ambitwizdib", "com.p3.soneridigital", "com.avanza.ambitwizhmb",
        "com.digibop.mobile", "com.bop.bopwalletapp", "com.avanza.sindhbanklimited",
        "com.silkbank.silkbankretail", "pk.com.albaraka.mobileapp", "com.mashreq.pakistan",
        "com.raqamidigital.cbt", "com.mcbislamicbank.digital", "com.avanza.ambitwizsummit",
        "com.avanza.digitalfwbl", "com.temenos.bok", "com.mobile.samba", "com.finja.simsim",
        "com.mobilinkbank", "com.kmbl.retail.production", "com.KMBL.retail", "com.ubank.consumerdigital",
        "pk.com.nrspbank.superapp", "com.avanza.ambitwiznrsp", "com.fmfb.firstwallet",
        "com.onelink.sohnidharti.app",
        // US
        "com.chase.sig.android", "com.infonow.bofa", "com.wf.wellsfargomobile", "com.konylabs.capitalone",
        "com.citi.citimobile", "com.usbank.mobilebanking", "com.pnc.ecommerce.mobile", "com.truist.mobile",
        "com.tdbank", "com.ally.MobileBanking", "com.discoverfinancial.mobile",
        "com.americanexpress.android.acctsvcs.us", "com.navyfederal.android", "com.usaa.mobile.android.usaa",
        "org.penfed.mobile.banking", "org.becu.androidapp", "com.golden1.mobilebanking",
        "com.citizensbank.androidapp", "com.clairmail.fth", "com.key.android", "com.regions.mobbanking",
        "com.mtb.mbanking.sc.retail.prod", "com.huntington.m", "com.sovereign.santander",
        "com.frostbank.android", "com.cibc.android.us.app", "com.marcus.android", "com.creditonebank.mobile",
        "com.onedebit.chime", "com.sofi.mobile", "com.varomoney.bank", "com.current.app", "com.dave",
        "com.moneylion", "com.greendotcorp.go2bank", "com.onefinance.one", "com.aspiration.app",
        "com.netspend.mobileapp.westernunion", "com.paypal.merchant.client", "com.affirm.central",
        "com.afterpaymobile",
        // CA
        "com.td", "com.rbc.mobile.android", "com.bmo.mobile", "com.scotiabank.banking",
        "com.cibc.android.mobi", "ca.bnc.android", "com.desjardins.mobile",
        "ca.tangerine.clients.banking.app", "com.pcfinancial.mobile", "ca.pcfinancial.bank",
        "com.eqbank.eqbank", "com.atb.ATBMobile", "ca.koho", "com.americanexpress.android.acctsvcs.ca",
        // AU
        "com.commbank.netbank", "org.westpac.bank", "com.anz.android.gomoney", "com.anz.lotus",
        "au.com.nab.mobile", "org.stgeorge.bank", "org.banksa.bank", "org.bom.bank",
        "au.com.ingdirect.android", "au.com.ing.banking", "com.bendigobank.mobile", "au.com.up.money",
        "au.com.bankwest.mobile", "au.com.macquarie.banking", "au.com.suncorp.marketplace",
        "au.com.bank86400", "au.com.hsbc.hsbcaustralia", "au.com.mebank.banking", "au.com.boq.mobilebanking",
        "com.bankofqueensland.boq", "au.com.cua.mb", "com.fusion.beyondbank", "com.appfactory.tmb",
        "au.com.newcastlepermanent", "com.fusion.banking", "com.peopleschoice.peopleschoice",
        "au.com.heritage.app", "au.com.peoplefirstbank", "com.greater.Greater", "au.com.amp.bank.prod",
        "com.rabobank.prod.au", "com.westernunion.moneytransferr3app.au",
        // NZ
        "nz.co.anz.android.mobilebanking", "nz.co.asb.asbmobile", "nz.co.bnz.droidbanking", "nz.co.westpac",
        "nz.co.kiwibank.mobile", "nz.co.sbsbank.mobile", "tsb.mobilebanking", "nz.co.cooperativebank",
        "nz.co.heartland.mobileapp.android", "com.rabobank.android.prod.nz", "com.rabobank.prod.nz",
        "com.westernunion.moneytransferr3app.nz",
        // France
        "fr.creditagricole.androidapp", "net.bnpparibas.mescomptes", "mobi.societegenerale.mobile.lappli",
        "fr.banquepopulaire.cyberplus", "fr.lcl.android.customerarea", "com.cic_prod.bad", "com.cm_prod.bad",
        "com.fullsix.android.labanquepostale.accountaccess", "com.boursorama.android.clients", "com.lydia",
        // Spain
        "com.bbva.bbvacontigo", "es.bancosantander.apps", "es.lacaixa.mobile.android.newwapicon",
        "net.inverline.bancosabadell.officelocator.android", "com.bankinter.launcher",
        "www.ingdirect.nativeframe", "es.openbank.mobile",
        // Italy
        "com.latuabancaperandroid", "com.unicredit", "com.posteitaliane.spim",
        "posteitaliane.posteapp.appposteid", "com.fineco.it", "com.satispay.customer", "it.hype.app",
        // Sweden
        "com.handelsbanken.mobile.android", "se.seb.privatkund", "se.swedbank.mobil", "se.bankgirot.swish",
        "com.bankid.bus", "se.nordea.mobilebank",
        // Finland
        "fi.nordea.mobilebank", "com.danskebank.mobilebank3.fi",
        // Denmark
        "dk.nordea.mobilebank", "com.danskebank.mobilebank3.dk", "dk.danskebank.mobilepay",
        "com.lunarway.app",
        // Nordics
        "com.nordea.mobiletoken",
        // Norway
        "no.dnb.vipps",
        // Poland
        "pl.pkobp.iko", "pl.mbank", "softax.pekao.powerpay", "pl.bzwbk.bzwbk24", "pl.ing.mojeing",
        "wit.android.bcpBankingApp.millenniumPL", "pl.aliorbank.aib",
        // Belgium
        "com.kbc.mobile.android.phone.kbc", "be.belfius.directmobile.android",
        "mobi.inthepocket.bcmc.bancontact",
        // Austria
        "at.erstebank.george",
        // Portugal
        "pt.sibs.android.mbway",
        // Indonesia
        "com.bca", "id.co.bri.brimo", "id.bmri.livin", "src.com.bni", "id.co.bankbkemobile.digitalbank",
        "com.jago.digitalBanking", "com.bcadigital.blu", "com.btpn.dc", "id.co.cimbniaga.mobile.android",
        "id.com.uiux.mobile", "id.dana", "ovo.id", "com.gojek.gopay", "com.telkom.mwallet",
        // Malaysia
        "com.maybank2u.life", "com.cimb.cimbocto", "com.pbb.mypb", "com.rhbgroup.rhbmobilebanking",
        "my.com.hongleongconnect.mobileconnect", "com.ambank.ambankonline", "my.com.gxbank.app",
        "my.com.tngdigital.ewallet", "my.com.myboost",
        // Philippines
        "ph.com.bdo.retail", "com.bpi.ng.app", "ph.com.metrobank.mcc.mbonline", "com.unionbankph.online",
        "com.landbank.mobilebanking", "ph.com.psbankonline", "com.globe.gcash.android", "com.paymaya",
        "ph.seabank.seabank",
        // Singapore
        "com.dbs.sg.dbsmbanking", "com.dbs.dbspaylah", "com.ocbc.mobile", "com.uob.mighty.app",
        "sg.com.gxs.app",
        // Thailand
        "com.kasikorn.retail.mbanking.wap", "com.scb.phone", "com.bbl.mobilebanking", "ktbcs.netbank",
        "com.ktb.customer.qr", "com.krungsri.kma", "th.co.truemoney.wallet",
        // Vietnam
        "com.VCB", "com.vietinbank.ipay", "com.vnpay.bidv", "com.vnpay.Agribank3g", "com.mbmobile",
        "vn.com.techcombank.bb.app", "com.tpb.mb.gprsandroid", "com.vib.myvib2", "vn.com.vng.zalopay",
        // Japan
        "jp.co.rakuten_bank.rakutenbank", "jp.co.smbc.direct", "jp.mufg.bk.applisp.app",
        "jp.co.japannetbank.smtapp.balance", "jp.co.netbk", "jp.japanpost.jp_bank.bankbookapp",
        "jp.japanpost.jp_bank.FIDOapp", "jp.co.mizuhobank.mizuhoapp", "jp.ne.paypay.android.app",
        "jp.co.rakuten.pay",
        // South Korea
        "com.kbstar.kbbank", "com.shinhan.sbanking", "com.wooribank.smart.npib", "com.hanabank.oqf",
        "nh.smart.banking", "com.ibk.android.ionebank", "com.kakaobank.channel", "viva.republica.toss",
        "com.kakaopay.app", "com.naverfin.payapp",
        // China
        "cmb.pb", "com.unionpay",
        // Hong Kong
        "hk.com.hsbc.hsbchkmobilebanking", "hk.com.hsbc.paymefromhsbc", "com.hangseng.rbmobile",
        "com.bochk.app.aos", "com.bochk.bocpay", "com.mtel.androidbea", "com.icbc.icbcasia",
        "com.octopuscards.nfc_reader",
        // Brazil
        "com.nu.production", "com.itau", "com.itau.pers", "com.bradesco", "br.com.bradesco.next",
        "br.com.bb.android", "br.com.gabba.Caixa", "br.gov.caixa.tem", "com.santander.app",
        "br.com.intermedium", "com.c6bank.app", "com.picpay", "br.com.uol.ps.myaccount", "br.com.neon",
        "br.com.sicoobnet", "br.com.sicredi.app", "br.com.banrisul", "com.recarga.recarga",
        "br.com.bancopan.cartoes", "com.btg.pactual.banking", "br.com.meupag", "br.com.agipag.app",
        "br.com.digio", "br.gov.bnb.nelmobile",
        // Argentina
        "com.mercadopago.wallet", "ar.com.santander.rio.mbanking", "com.bbva.nxt_argentina",
        "com.mosync.app_Banco_Galicia", "com.banconacion.bnamas", "com.macro.banco.ar",
        "ar.com.bancoprovincia.CuentaDNI", "ar.bapro", "ar.com.bancar.uala", "com.brubank",
        "com.playdigital.modo", "ar.com.personalpay",
        // Mexico
        "com.bancomer.mbanking", "com.citibanamex.banamexmobile",
        "org.microemu.android.model.common.VTUserApplicationBNRTMB", "mx.bancosantander.supermovil",
        "mx.com.bancoazteca.bazdigitalmovil", "mx.hsbc.hsbcmexico", "com.scotiabankmx.scotiamovil",
        "mx.com.miapp", "com.banregio.hey", "com.cloudsourceit.banregio", "com.inbursa.client",
        "com.digitalfemsa_spinplus", "mx.klar.app", "ai.powerup.stori",
        // Colombia
        "co.com.bancolombia.personas.superapp", "com.nequi.MobileApp", "com.davivienda.daviplataapp",
        "com.davivienda.daviviendaapp", "com.bancodebogota.bancamovil", "co.com.bbva.mb",
        "com.grupoavaloc1.bancamovil", "com.bcs.retail",
        // Chile
        "net.veritran.becl.prod", "cl.bancochile.mi_banco", "cl.santander.smartphone", "cl.bci.app.personas",
        "cl.bci.sismo.mach", "com.krealo.tenpo", "com.konylabs.ItauMobileBank", "cl.android",
        // Nigeria
        "team.opay.pay", "com.transsnet.palmpay", "com.moniepoint.personal", "com.kudabank.app",
        "com.gtbank.gtworldv1", "com.zenithBank.eazymoney", "com.wemabank.alat.prod",
        "ng.com.fairmoney.fairmoney", "com.lenddo.mobile.paylater", "com.accessbank.nextgen",
        "com.firstbank.firstmobile", "com.ubanquity.redd.uba", "com.sterlingng.sterlingmobile",
        "com.mypaga.customer", "com.fidelity.mobile", "com.appzonegroup.fcmb", "com.StanbicMobile",
        "com.ceva.ubmobile.stallion",
        // Pan-Africa (Nigeria, Ghana, Kenya and others)
        "com.ecobank.mobileapp5",
        // Kenya
        "com.safaricom.mpesa.lifestyle", "com.safaricom.mysafaricom", "ke.co.equitygroup.equitymobile",
        "com.kcb.mobilebanking.android.mbp", "com.mcoopcash.retail6", "com.nicbank.android",
        "com.loopdfs.consumer", "com.absa.ke.mobile.android.ui", "com.inventureaccess.safarirahisi",
        "com.branch_international.branch.branch_demo_android",
        // Pan-Africa (Kenya, Nigeria and others)
        "com.airtel.africa.selfcare",
        // South Africa
        "capitec.acuity.mobile.prod", "za.co.fnb.connect.itt", "com.barclays.absa.banking", "za.co.nedbank",
        "bank.discovery.banking.production.release", "za.co.android.africanbank", "com.investec.app",
        "za.co.neolabs.bankzero", "za.co.gotyme",
        // South Africa (also Stanbic in Ghana, Kenya and others)
        "com.sbg.mobile.phone",
        // Ghana (also Uganda, Cameroon, Cote d'Ivoire, Zambia, Benin)
        "mtnft.momo.consumer",
        // Ghana
        "com.airteltigo.app", "com.modefin.gcbui", "com.zeepay", "calbank.com.app",
        // Morocco
        "com.attijariwafabank.main", "com.b3g.cih.online", "ma.gbp.pocketbank", "com.BMCE_prod.bad",
        "com.cashplus.mobileapp", "com.saphir.baridbankmobile", "ma.baridcash.saphir.baridpay",
        "com.orange.orangemoney", "com.sgma.prod", "ma.creditagricole.banke",
        // Pan-Africa (Nigeria, Ghana, Kenya, South Africa and others)
        "com.chippercash",
        // Pan-Africa (West Africa)
        "com.wave.personal"
    )

    @Volatile private var installed: Set<String>? = null

    fun isKnown(packageName: String): Boolean = packageName in KNOWN

    fun isBanking(packageName: String, label: String?): Boolean =
        packageName in KNOWN ||
            packageName.contains("bank", ignoreCase = true) ||
            label?.contains("bank", ignoreCase = true) == true

    /** Installed launcher apps that are banking apps, cached until [invalidate]. */
    fun installed(context: Context): Set<String> {
        installed?.let { return it }
        val pm = context.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val found = try {
            pm.queryIntentActivities(launcher, 0)
                .map { it.activityInfo }
                .filter {
                    // A name match alone would let any app relabelled "... Bank"
                    // and sideloaded skip both the tunnel and the content checks.
                    it.packageName in KNOWN ||
                        (isBanking(it.packageName, it.applicationInfo.loadLabel(pm).toString()) &&
                            installer(pm, it.packageName) == PLAY_STORE)
                }
                .map { it.packageName }
                .toSet()
        } catch (_: Exception) {
            emptySet()
        }
        installed = found
        return found
    }

    private const val PLAY_STORE = "com.android.vending"

    private fun installer(pm: android.content.pm.PackageManager, packageName: String): String? = try {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            pm.getInstallSourceInfo(packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION")
            pm.getInstallerPackageName(packageName)
        }
    } catch (_: Exception) {
        null
    }

    /** The installed set if already loaded, without loading it. */
    fun cached(): Set<String>? = installed

    fun invalidate() {
        installed = null
    }
}
