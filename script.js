// ============================================
// CONFIGURATION SUPABASE - VERSION AVEC supabase1
// ============================================

// Vérifier si Supabase est déjà initialisé dans le scope global
if (typeof window.__SUPABASE_INSTANCE === 'undefined') {
    console.log('🚀 Initialisation Supabase...');
    
    // Vérifier si le script Supabase est chargé
    if (typeof window.supabase === 'undefined') {
        console.error('❌ Supabase n\'est pas chargé ! Vérifiez que le script est inclus dans votre HTML');
        console.error('📌 Ajoutez: <script src="https://unpkg.com/@supabase/supabase-js@2"></script> AVANT script.js');
        
        // Créer un placeholder pour éviter les erreurs
        window.__SUPABASE_INSTANCE = {
            auth: { 
                getSession: () => Promise.resolve({ data: { session: null }, error: null }),
                signOut: () => Promise.resolve({ error: null }),
                onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
            },
            from: () => ({ 
                select: () => Promise.resolve({ data: [], error: null }),
                insert: () => Promise.resolve({ data: [], error: null }),
                update: () => Promise.resolve({ data: [], error: null }),
                delete: () => Promise.resolve({ data: [], error: null })
            })
        };
    } else {
        try {
            const SUPABASE_URL = 'https://kkgguofgpzdlgtbzvnzn.supabase.co';
            const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZ2d1b2ZncHpkbGd0Ynp2bnpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTI3MTgsImV4cCI6MjA4NjU2ODcxOH0.4BP8UbxgRa3ZSueS9XBNpx3JEG9yz7Un97RnoHh1Ksc';
            
            
            window.__SUPABASE_INSTANCE = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('✅ Supabase initialisé avec succès');
        } catch (error) {
            console.error('❌ Erreur initialisation Supabase:', error);
            window.__SUPABASE_INSTANCE = null;
        }
    }
}

// Utiliser l'instance unique avec le nouveau nom
const supabase1 = window.__SUPABASE_INSTANCE;

// ============================================
// VARIABLES GLOBALES
// ============================================
let UTILISATEUR_COURANT = null;
let userData = null;
let userRoles = [];
let produitsEnCache = [];
let authInitialized = false; // Flag pour savoir si l'auth est initialisée

// ============================================
// FONCTIONS DE COMPRESSION D'IMAGES
// ============================================

// Compresser une image avant upload
async function compresserImage(file, maxWidth = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                // Calculer les nouvelles dimensions
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height = Math.floor(height * (maxWidth / width));
                    width = maxWidth;
                }
                
                // Créer un canvas pour redimensionner
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convertir en blob avec compression
                canvas.toBlob((blob) => {
                    // Créer un nouveau fichier à partir du blob
                    const compressedFile = new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    });
                    resolve(compressedFile);
                }, 'image/jpeg', quality);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// Uploader une image vers Supabase Storage
async function uploaderImage(file, dossier = 'produits') {
    if (!supabase1) {
        throw new Error('Supabase non initialisé');
    }
    
    // Attendre que l'utilisateur soit chargé
    if (!UTILISATEUR_COURANT) {
        await attendreUtilisateur();
    }
    
    try {
        // Compresser l'image d'abord
        console.log(`🖼️ Compression de l'image: ${file.name}`);
        const compressedFile = await compresserImage(file);
        console.log(`✅ Image compressée: ${(compressedFile.size / 1024).toFixed(2)} Ko`);
        
        // Générer un nom de fichier unique
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const extension = 'jpg';
        const fileName = `${timestamp}_${random}.${extension}`;
        const filePath = `${dossier}/${UTILISATEUR_COURANT}/${fileName}`;
        
        // Upload vers Supabase Storage
        console.log(`📤 Upload vers Supabase: ${filePath}`);
        const { data, error } = await supabase1.storage
            .from('photos') // Nom de votre bucket
            .upload(filePath, compressedFile, {
                cacheControl: '3600',
                upsert: false
            });
            
        if (error) throw error;
        
        // Récupérer l'URL publique
        const { data: { publicUrl } } = supabase1.storage
            .from('photos')
            .getPublicUrl(filePath);
            
        console.log(`✅ Image uploadée: ${publicUrl}`);
        return publicUrl;
        
    } catch (error) {
        console.error('❌ Erreur upload image:', error);
        throw error;
    }
}

// Uploader plusieurs images
async function uploaderPlusieursImages(fichiers, dossier = 'produits') {
    const urls = [];
    let successCount = 0;
    let errorCount = 0;
    
    for (const fichier of fichiers) {
        try {
            const url = await uploaderImage(fichier.file || fichier, dossier);
            urls.push(url);
            successCount++;
        } catch (error) {
            console.error('Erreur upload image:', error);
            errorCount++;
            // Continuer avec les autres images même si une échoue
        }
    }
    
    console.log(`📊 Upload terminé: ${successCount} succès, ${errorCount} échecs`);
    return urls;
}

// ============================================
// GESTION DE L'AUTHENTIFICATION
// ============================================

// Fonction pour attendre que l'utilisateur soit chargé
async function attendreUtilisateur() {
    if (authInitialized && UTILISATEUR_COURANT) return true;
    
    // Attendre max 5 secondes
    for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (UTILISATEUR_COURANT) return true;
    }
    return false;
}

// Vérifier la connexion
async function verifierConnexion() {
    console.log('🔐 Vérification connexion...');
    
    if (!supabase1) {
        console.error('❌ Supabase non initialisé');
        authInitialized = true;
        return false;
    }
    
    try {
        const { data: { session }, error } = await supabase1.auth.getSession();
        
        if (error) {
            console.error('Erreur session:', error);
            authInitialized = true;
            return false;
        }

        if (!session) {
            console.log('⚠️ Aucune session');
            authInitialized = true;
            return false;
        }

        UTILISATEUR_COURANT = session.user.id;
        
        // Récupérer les informations utilisateur
        try {
            const { data: userInfo, error: userError } = await supabase1
                .from('utilisateurs')
                .select('*')
                .eq('id', session.user.id)
                .maybeSingle();

            if (userError) {
                console.error('Erreur récupération utilisateur:', userError);
                userRoles = [];
            } else if (userInfo) {
                userData = userInfo;
                userRoles = userInfo.roles || [];
            }
        } catch (error) {
            console.error('Erreur récupération utilisateur:', error);
            userRoles = [];
        }

        console.log('✅ Utilisateur connecté:', UTILISATEUR_COURANT);
        authInitialized = true;
        return true;

    } catch (error) {
        console.error('❌ Erreur:', error);
        authInitialized = true;
        return false;
    }
}

// Charger les infos de l'utilisateur
async function chargerInfosUtilisateur() {
    if (!UTILISATEUR_COURANT || !supabase1) return;
    
    try {
        const { data, error } = await supabase1
            .from('utilisateurs')
            .select('nom, email, telephone, avatar, roles, date_inscription, note_moyenne, nombre_ventes, nombre_achats')
            .eq('id', UTILISATEUR_COURANT)
            .maybeSingle();

        if (!error && data) {
            userData = data;
            userRoles = data.roles || [];
            
            // Mettre à jour l'affichage si les éléments existent
            const userNameElement = document.getElementById('user-name');
            if (userNameElement) userNameElement.textContent = data.nom || 'Utilisateur';
            
            const dropdownEmail = document.getElementById('dropdown-email');
            if (dropdownEmail) dropdownEmail.textContent = data.email || '';
            
            const dropdownName = document.getElementById('dropdown-name');
            if (dropdownName) dropdownName.textContent = data.nom || 'Utilisateur';
            
            const dropdownTelephone = document.getElementById('dropdown-telephone');
            if (dropdownTelephone) dropdownTelephone.textContent = data.telephone || 'Téléphone non renseigné';
        }
    } catch (error) {
        console.error('Erreur chargement infos utilisateur:', error);
    }
}

// Afficher l'interface utilisateur connecté
function afficherUtilisateurConnecte() {
    console.log('👤 Affichage interface utilisateur connecté');
    
    const btnConnexion = document.getElementById('btn-connexion');
    const btnUser = document.getElementById('btn-user');
    
    if (btnConnexion) btnConnexion.classList.add('d-none');
    if (btnUser) {
        btnUser.classList.remove('d-none');
        btnUser.innerHTML = `<i class="fa fa-user me-1"></i>${userData?.nom?.split(' ')[0] || 'Compte'}`;
    }
}

// Afficher le bouton de connexion
function afficherBoutonConnexion() {
    console.log('🔵 Affichage bouton connexion');
    
    const btnConnexion = document.getElementById('btn-connexion');
    const btnUser = document.getElementById('btn-user');
    
    if (btnConnexion) btnConnexion.classList.remove('d-none');
    if (btnUser) btnUser.classList.add('d-none');
    
    UTILISATEUR_COURANT = null;
    userData = null;
    userRoles = [];
}

// Initialiser le dropdown utilisateur
function initialiserDropdownUtilisateur() {
    const btnUser = document.getElementById('btn-user');
    const dropdown = document.getElementById('user-dropdown');
    
    if (btnUser) {
        btnUser.addEventListener('click', function(e) {
            e.stopPropagation();
            if (dropdown) dropdown.classList.toggle('show');
        });
    }

    document.addEventListener('click', function() {
        if (dropdown) dropdown.classList.remove('show');
    });

    if (dropdown) {
        dropdown.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }

    const btnDeconnexion = document.getElementById('btn-deconnexion');
    if (btnDeconnexion) {
        btnDeconnexion.addEventListener('click', deconnexion);
    }
}

// Déconnexion
async function deconnexion() {
    if (!supabase1) return;
    
    try {
        const { error } = await supabase1.auth.signOut();
        if (error) throw error;
        
        afficherBoutonConnexion();
        const dropdown = document.getElementById('user-dropdown');
        if (dropdown) dropdown.classList.remove('show');
        
        if (typeof chargerAnnoncesRecentes === 'function') chargerAnnoncesRecentes();
        
        console.log('✅ Déconnexion réussie');
    } catch (error) {
        console.error('Erreur déconnexion:', error);
        alert('Erreur lors de la déconnexion');
    }
}

// ============================================
// GESTION DES PRODUITS (pour page d'accueil)
// ============================================

// Charger les annonces récentes
async function chargerAnnoncesRecentes(filtre = 'tous') {
    console.log(`📦 Chargement des annonces (filtre: ${filtre})...`);
    
    const container = document.getElementById('produits-container');
    if (!container || !supabase1) return;
    
    try {
        // Requête pour récupérer les annonces récentes
        let query = supabase1
            .from('produits')
            .select(`
                *,
                vendeur:utilisateurs!vendeur_id(nom, telephone, email, avatar, note_moyenne)
            `)
            .eq('est_actif', true);
        
        // Appliquer le filtre si ce n'est pas "tous"
        if (filtre !== 'tous') {
            query = query.eq('categorie', filtre);
        }
        
        const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(8);
            
        if (error) throw error;
        
        produitsEnCache = data || [];
        
        if (produitsEnCache.length === 0) {
            container.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="fa fa-box-open fa-4x text-muted mb-3"></i>
                    <h5>Aucune annonce pour le moment</h5>
                    <p class="text-muted">Soyez le premier à publier une annonce !</p>
                </div>
            `;
            return;
        }
        
        // Afficher les annonces
        container.innerHTML = '';
        
        for (const annonce of produitsEnCache) {
            await afficherAnnonce(annonce, container);
        }
        
        console.log(`✅ ${produitsEnCache.length} annonces chargées`);
        
    } catch (error) {
        console.error('❌ Erreur chargement annonces:', error);
        if (container) {
            container.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="fa fa-exclamation-triangle fa-4x text-danger mb-3"></i>
                    <h5>Erreur de chargement</h5>
                    <p class="text-muted">Impossible de charger les annonces. Veuillez réessayer.</p>
                    <button class="btn btn-primary mt-3" onclick="window.location.reload()">Réessayer</button>
                </div>
            `;
        }
    }
}

// Afficher une annonce
async function afficherAnnonce(annonce, container) {
    if (!annonce || !container) return;
    
    // Échapper les caractères pour éviter les erreurs
    const nomEchappe = (annonce.titre || 'Sans titre').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const descriptionEchappe = (annonce.description || '').substring(0, 50).replace(/'/g, "\\'").replace(/"/g, '&quot;') + '...';
    const imageUrl = annonce.image_url || annonce.images?.[0] || 'image/default-product.jpg';
    
    container.innerHTML += `
        <div class="col-md-3">
            <div class="product-card" onclick="redirigerVersAnnonce('${annonce.id}')">
                <img src="${imageUrl}" alt="${nomEchappe}" onerror="this.src='image/default-product.jpg'">
                <div class="badge-etat">${annonce.etat || 'Occasion'}</div>
                <div class="p-3">
                    <h6>${nomEchappe}</h6>
                    <p class="small text-muted">${descriptionEchappe}</p>
                    <div class="prix">${annonce.prix ? annonce.prix.toLocaleString() : '0'} FCFA</div>
                    <div class="d-flex justify-content-between align-items-center mt-2">
                        <small class="text-muted">
                            <i class="fa fa-user me-1"></i>${annonce.vendeur?.nom?.split(' ')[0] || 'Vendeur'}
                        </small>
                        ${annonce.vendeur?.note_moyenne ? 
                            `<small class="text-warning"><i class="fa fa-star me-1"></i>${annonce.vendeur.note_moyenne}</small>` : 
                            ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// FONCTIONS DE RECHERCHE
// ============================================

function rechercherAnnonces() {
    const searchInput = document.querySelector('input[type="search"]');
    if (!searchInput) return;
    
    const terme = searchInput.value.trim();
    
    if (terme) {
        window.location.href = `annonces.html?q=${encodeURIComponent(terme)}`;
    } else {
        alert('Veuillez saisir un terme de recherche');
    }
}

// ============================================
// NAVIGATION
// ============================================

function redirigerVersAnnonce(annonceId) {
    window.location.href = `detail-annonce.html?id=${annonceId}`;
}

function goTo(page) {
    window.location.href = page;
}

// ============================================
// GESTION DES FILTRES
// ============================================

function initialiserFiltres() {
    const filtres = document.querySelectorAll('.filter-btn');
    
    filtres.forEach(btn => {
        btn.addEventListener('click', function() {
            // Retirer la classe active de tous les boutons
            filtres.forEach(b => b.classList.remove('active'));
            
            // Ajouter la classe active au bouton cliqué
            this.classList.add('active');
            
            // Récupérer le filtre
            const filtre = this.getAttribute('data-filter');
            
            // Charger les annonces avec le filtre
            chargerAnnoncesRecentes(filtre);
        });
    });
}

// ============================================
// EFFETS D'ANIMATION
// ============================================

function initialiserAnimations() {
    document.querySelectorAll('a').forEach(link => {
        link.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.05)';
            this.style.transition = 'transform 0.2s';
        });
        link.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
        });
    });
}

// ============================================
// ÉCOUTEURS D'ÉVÉNEMENTS SUPABASE
// ============================================

if (supabase1) {
    supabase1.auth.onAuthStateChange(async (event, session) => {
        console.log('🔄 Changement état auth:', event);
        
        if (event === 'SIGNED_IN' && session) {
            console.log('🎉 Connexion détectée');
            UTILISATEUR_COURANT = session.user.id;
            
            setTimeout(async () => {
                await chargerInfosUtilisateur();
                afficherUtilisateurConnecte();
                if (typeof chargerAnnoncesRecentes === 'function') chargerAnnoncesRecentes();
            }, 500);
            
        } else if (event === 'SIGNED_OUT') {
            console.log('🚪 Déconnexion détectée');
            UTILISATEUR_COURANT = null;
            userData = null;
            userRoles = [];
            afficherBoutonConnexion();
            if (typeof chargerAnnoncesRecentes === 'function') chargerAnnoncesRecentes();
        }
    });
}



// ============================================
// COMPTEUR DE COMMANDES EN ATTENTE DE LIVRAISON
// ============================================

let commandesEnAttente = 0;
let verificationInterval = null;

// Initialiser le compteur de commandes en attente
function initialiserCompteurCommandes() {
    console.log('🔢 Initialisation du compteur de commandes en attente...');
    
    // Vérifier si l'utilisateur est connecté
    if (!UTILISATEUR_COURANT) {
        console.log('👤 Utilisateur non connecté, pas de compteur');
        return;
    }
    
    // Vérifier immédiatement
    verifierCommandesEnAttente();
    
    // Vérifier toutes les 30 secondes
    if (verificationInterval) {
        clearInterval(verificationInterval);
    }
    verificationInterval = setInterval(verifierCommandesEnAttente, 30000);
    
    // Ajouter un écouteur pour la visibilité de la page
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden && UTILISATEUR_COURANT) {
            console.log('👁️ Page visible, vérification des commandes...');
            verifierCommandesEnAttente();
        }
    });
    
    // Écouter les changements d'authentification
    if (supabase1) {
        supabase1.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                console.log('🔢 Connexion détectée, activation compteur');
                UTILISATEUR_COURANT = session.user.id;
                verifierCommandesEnAttente();
                
                if (!verificationInterval) {
                    verificationInterval = setInterval(verifierCommandesEnAttente, 30000);
                }
            } else if (event === 'SIGNED_OUT') {
                console.log('🔢 Déconnexion détectée, désactivation compteur');
                cacherCompteur();
                if (verificationInterval) {
                    clearInterval(verificationInterval);
                    verificationInterval = null;
                }
            }
        });
    }
}

// Vérifier les commandes en attente de livraison
async function verifierCommandesEnAttente() {
    if (!UTILISATEUR_COURANT || !supabase1) return;
    
    try {
        console.log('🔍 Vérification des commandes en attente...');
        
        // 🔥 Compter UNIQUEMENT les commandes en attente de livraison
        const { count, error } = await supabase1
            .from('commandes')
            .select('*', { count: 'exact', head: true })
            .eq('id_vendeur', UTILISATEUR_COURANT)
            .eq('etat', 'en attente de livraison'); // Seulement en attente de livraison
        
        if (error) {
            console.error('❌ Erreur vérification commandes:', error);
            return;
        }
        
        const nouveauCompte = count || 0;
        
        if (nouveauCompte !== commandesEnAttente) {
            console.log(`📦 Commandes en attente: ${nouveauCompte}`);
            commandesEnAttente = nouveauCompte;
            mettreAJourCompteur();
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la vérification des commandes:', error);
    }
}

// Mettre à jour l'affichage du compteur
function mettreAJourCompteur() {
    const compteur = document.getElementById('commandes-en-attente');
    if (!compteur) return;
    
    if (commandesEnAttente > 0) {
        compteur.textContent = commandesEnAttente > 99 ? '99+' : commandesEnAttente;
        compteur.style.display = 'inline';
        
        // Optionnel : Animation quand le nombre change
        compteur.style.animation = 'none';
        compteur.offsetHeight; // Force reflow
        compteur.style.animation = 'compteur-pulse 0.5s ease';
    } else {
        compteur.style.display = 'none';
    }
}

// Cacher le compteur
function cacherCompteur() {
    commandesEnAttente = 0;
    mettreAJourCompteur();
}

// Animation CSS pour le compteur
const styleCompteur = document.createElement('style');
styleCompteur.textContent = `
@keyframes compteur-pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); }
}
`;
document.head.appendChild(styleCompteur);
























// ============================================
// INITIALISATION DE LA PAGE D'ACCUEIL
// ============================================

async function initialiserPageAccueil() {
    console.log('🚀 Initialisation de la page d\'accueil...');
    
    initialiserAnimations();
    initialiserDropdownUtilisateur();
    initialiserFiltres();
    
    // Vérifier connexion
    const estConnecte = await verifierConnexion();
    
    if (estConnecte) {
        await chargerInfosUtilisateur();
        afficherUtilisateurConnecte();

        initialiserCompteurCommandes();

        initialiserCompteurVentes();
    }
    
    // Charger les annonces (même sans connexion)
    await chargerAnnoncesRecentes();
    
    console.log('✅ Initialisation terminée');
}

// ============================================
// PAGE CONNEXION
// ============================================

// Variables pour la page de connexion
let resetPasswordModal = null;
let connexionLoading = false;

// Initialiser la page de connexion
function initialiserPageConnexion() {
    console.log('🔑 Initialisation page de connexion...');
    
    // Initialiser les événements spécifiques à la connexion
    initialiserEvenementsConnexion();
    activerValidationFormulaire();
    chargerEmailMemoire();
    
    // Vérifier si l'utilisateur est déjà connecté
    verifierConnexionExistante();
    
    // Initialiser le modal de réinitialisation
    const modalElement = document.getElementById('resetPasswordModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        resetPasswordModal = new bootstrap.Modal(modalElement);
    }
}

// Initialiser les événements de la page de connexion
function initialiserEvenementsConnexion() {
    // Toggle mot de passe
    const togglePassword = document.getElementById('toggle-password');
    if (togglePassword) {
        togglePassword.addEventListener('click', function() {
            const passwordInput = document.getElementById('password');
            const icon = this.querySelector('i');
            
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                passwordInput.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    }

    // Soumission du formulaire
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            connexion();
        });
    }

    // Mot de passe oublié
    const forgotPassword = document.getElementById('forgot-password');
    if (forgotPassword) {
        forgotPassword.addEventListener('click', function(e) {
            e.preventDefault();
            afficherModalResetPassword();
        });
    }

    // Envoi de réinitialisation
    const btnSendReset = document.getElementById('btn-send-reset');
    if (btnSendReset) {
        btnSendReset.addEventListener('click', envoyerResetPassword);
    }

    // Sauvegarde de l'email dans localStorage
    const emailInput = document.getElementById('email');
    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            if (this.value.trim()) {
                localStorage.setItem('remembered_email', this.value.trim());
            }
        });
    }
}

// Charger l'email sauvegardé
function chargerEmailMemoire() {
    const rememberedEmail = localStorage.getItem('remembered_email');
    if (rememberedEmail) {
        const emailInput = document.getElementById('email');
        if (emailInput) {
            emailInput.value = rememberedEmail;
            // Déclencher la validation
            emailInput.dispatchEvent(new Event('input'));
        }
    }
}

// Activer/désactiver le bouton de connexion selon la validité du formulaire
function activerValidationFormulaire() {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const btnLogin = document.getElementById('btn-login');
    
    if (!emailInput || !passwordInput || !btnLogin) return;
    
    const verifierChamps = function() {
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();
        btnLogin.disabled = !email || !password;
    };
    
    emailInput.addEventListener('input', verifierChamps);
    passwordInput.addEventListener('input', verifierChamps);
}

// Fonction de connexion principale
async function connexion() {
    if (connexionLoading || !supabase1) return;
    
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    
    if (!emailInput || !passwordInput) return;
    
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    
    // Validation basique
    if (!email || !password) {
        afficherAlerte('Veuillez remplir tous les champs.', 'danger');
        return;
    }

    if (!validerEmail(email)) {
        afficherAlerte('Veuillez saisir une adresse email valide.', 'danger');
        return;
    }

    setConnexionLoading(true);

    try {
        console.log('🔄 Tentative de connexion pour:', email);
        
        // Connexion avec Supabase Auth
        const { data, error } = await supabase1.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        const user = data.user;
        if (!user) throw new Error('Erreur de connexion');

        console.log('✅ Connexion auth réussie, user ID:', user.id);

        // Sauvegarder l'email pour la prochaine fois
        localStorage.setItem('remembered_email', email);

        // Vérifier le profil utilisateur et les rôles
        const profil = await verifierOuCreerProfil(user);
        
        if (!profil) {
            // Si problème avec le profil, déconnecter
            await supabase1.auth.signOut();
            throw new Error('Erreur de configuration du profil');
        }

        // Afficher un message de bienvenue personnalisé
        let messageBienvenue = `Bienvenue ${profil.nom || email.split('@')[0]} !`;
        afficherAlerte(messageBienvenue, 'success');

        // Attendre un peu pour que la session soit bien établie
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Vérifier que la session est bien active
        const { data: { session: sessionVerifiee } } = await supabase1.auth.getSession();
        if (!sessionVerifiee) {
            throw new Error('Session non établie, veuillez réessayer');
        }

        console.log('✅ Session vérifiée, redirection...');
        
        // Redirection vers la page d'accueil
        setTimeout(() => {
            window.location.href = 'home.html?connexion=success&t=' + Date.now();
        }, 2000);

    } catch (error) {
        console.error('❌ Erreur de connexion:', error);
        
        let messageErreur = 'Erreur de connexion';
        if (error.message.includes('Invalid login credentials')) {
            messageErreur = 'Email ou mot de passe incorrect';
        } else if (error.message.includes('Email not confirmed')) {
            messageErreur = 'Veuillez confirmer votre email avant de vous connecter. Vérifiez votre boîte de réception.';
        } else if (error.message.includes('Session non établie')) {
            messageErreur = 'Problème de session, veuillez réessayer';
        } else {
            messageErreur = error.message;
        }
        
        afficherAlerte(messageErreur, 'danger');
    } finally {
        setConnexionLoading(false);
    }
}

// Vérifier ou créer le profil utilisateur
async function verifierOuCreerProfil(user) {
    if (!supabase1) return null;
    
    try {
        // Vérifier si l'utilisateur existe dans la table utilisateurs
        const { data: existingUser, error: selectError } = await supabase1
            .from('utilisateurs')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

        if (selectError) {
            console.warn('Erreur vérification utilisateur:', selectError);
        }

        // Si l'utilisateur existe déjà
        if (existingUser) {
            console.log('✅ Profil existant trouvé:', existingUser);
            return existingUser;
        }

        // Créer un nouveau profil utilisateur
        console.log('🆕 Création du profil utilisateur...');
        
        const nom = user.user_metadata?.nom || 
                   user.user_metadata?.full_name || 
                   user.email?.split('@')[0] || 
                   'Utilisateur';
        
        const telephone = user.user_metadata?.telephone || '';
        
        const nouveauProfil = {
            id: user.id,
            email: user.email,
            nom: nom,
            telephone: telephone,
            roles: ['acheteur', 'vendeur'], // Double rôle par défaut
            date_inscription: new Date().toISOString(),
            avatar: null, // Pas de photo de profil
            note_moyenne: 0,
            nombre_ventes: 0,
            nombre_achats: 0
        };

        const { data: insertedUser, error: insertError } = await supabase1
            .from('utilisateurs')
            .insert([nouveauProfil])
            .select()
            .single();

        if (insertError) {
            console.error('❌ Erreur création profil:', insertError);
            
            // Si erreur de duplication, essayer de récupérer
            if (insertError.code === '23505') { // Duplicate key
                const { data: retryUser } = await supabase1
                    .from('utilisateurs')
                    .select('*')
                    .eq('id', user.id)
                    .maybeSingle();
                    
                if (retryUser) return retryUser;
            }
            
            return null;
        }

        console.log('✅ Profil utilisateur créé avec double rôle (avatar: null)');
        return insertedUser;

    } catch (error) {
        console.error('❌ Erreur lors de la vérification/création du profil:', error);
        return null;
    }
}

// Afficher le modal de réinitialisation de mot de passe
function afficherModalResetPassword() {
    const emailInput = document.getElementById('email');
    const resetEmail = document.getElementById('reset-email');
    
    if (emailInput && resetEmail) {
        resetEmail.value = emailInput.value;
    }
    
    if (resetPasswordModal) {
        resetPasswordModal.show();
    }
}

/*// Envoyer l'email de réinitialisation
async function envoyerResetPassword() {
    if (!supabase1) return;
    
    const resetEmail = document.getElementById('reset-email');
    const btnSendReset = document.getElementById('btn-send-reset');
    const resetText = document.getElementById('reset-text');
    const resetSpinner = document.getElementById('reset-spinner');
    
    if (!resetEmail || !btnSendReset) return;
    
    const email = resetEmail.value.trim();
    
    if (!email || !validerEmail(email)) {
        afficherAlerte('Veuillez saisir une adresse email valide.', 'danger');
        return;
    }

    try {
        // Désactiver le bouton
        btnSendReset.disabled = true;
        if (resetText) resetText.classList.add('d-none');
        if (resetSpinner) resetSpinner.classList.remove('d-none');

        const { error } = await supabase1.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password.html`
        });

        if (error) throw error;

        // Fermer le modal
        if (resetPasswordModal) {
            resetPasswordModal.hide();
        }

        afficherAlerte('Un email de réinitialisation a été envoyé. Vérifiez votre boîte de réception.', 'success');
        
        // Sauvegarder l'email
        localStorage.setItem('remembered_email', email);
        
    } catch (error) {
        console.error('Erreur réinitialisation:', error);
        afficherAlerte("Erreur lors de l'envoi: " + error.message, 'danger');
    } finally {
        // Réactiver le bouton
        btnSendReset.disabled = false;
        if (resetText) resetText.classList.remove('d-none');
        if (resetSpinner) resetSpinner.classList.add('d-none');
    }
}*/



// ✅ Utilise le système natif Supabase — pas de table custom, pas de Resend
async function envoyerResetPassword() {
    if (!supabase1) return;

    const resetEmailInput = document.getElementById('reset-email');
    const btnSendReset    = document.getElementById('btn-send-reset');
    const resetText       = document.getElementById('reset-text');
    const resetSpinner    = document.getElementById('reset-spinner');
    if (!resetEmailInput) return;

    const email = resetEmailInput.value.trim();
    if (!email || !validerEmail(email)) {
        afficherAlerte('Veuillez saisir une adresse email valide.', 'danger');
        return;
    }

    if (btnSendReset)  btnSendReset.disabled = true;
    if (resetText)     resetText.classList.add('d-none');
    if (resetSpinner)  resetSpinner.classList.remove('d-none');

    try {
        console.log('📧 Envoi du lien de réinitialisation pour:', email);

        // ✅ Supabase envoie lui-même l'email avec un lien sécurisé
        // Le token_hash sera présent dans l'URL de redirection
        const { error } = await supabase1.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password.html`,
        });

        if (error) throw error;

        console.log('✅ Email de réinitialisation envoyé');
        localStorage.setItem('remembered_email', email);

        // Passer à l'étape de confirmation
        resetStep = 2;
        mettreAJourModalReset();

    } catch (error) {
        console.error('❌ Erreur reset:', error);

        let msg = "Erreur lors de l'envoi de l'email";
        if (error.message.includes('rate limit')) {
            msg = "Trop de tentatives. Veuillez réessayer dans quelques minutes.";
        } else if (error.message) {
            msg = error.message;
        }
        afficherAlerte(msg, 'danger');

        if (btnSendReset)  btnSendReset.disabled = false;
        if (resetText)     resetText.classList.remove('d-none');
        if (resetSpinner)  resetSpinner.classList.add('d-none');
    }
}





/*// Valider le format d'email
function validerEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

// Gérer l'état de chargement pour la connexion
function setConnexionLoading(loading) {
    connexionLoading = loading;
    const btnLogin = document.getElementById('btn-login');
    const loginText = document.getElementById('login-text');
    const loginSpinner = document.getElementById('login-spinner');

    if (!btnLogin || !loginText || !loginSpinner) return;
    
    btnLogin.disabled = loading;
    
    if (loading) {
        loginText.classList.add('d-none');
        loginSpinner.classList.remove('d-none');
    } else {
        loginText.classList.remove('d-none');
        loginSpinner.classList.add('d-none');
    }
}*/




function validerEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function setConnexionLoading(loading) {
    connexionLoading = loading;
    const btnLogin     = document.getElementById('btn-login');
    const loginText    = document.getElementById('login-text');
    const loginSpinner = document.getElementById('login-spinner');
    if (!btnLogin || !loginText || !loginSpinner) return;
    btnLogin.disabled = loading;
    if (loading) {
        loginText.classList.add('d-none');
        loginSpinner.classList.remove('d-none');
    } else {
        loginText.classList.remove('d-none');
        loginSpinner.classList.add('d-none');
    }
}




/*// Afficher une alerte
function afficherAlerte(message, type) {
    // Chercher un conteneur d'alerte existant
    let alertContainer = document.getElementById('alert-container');
    
    if (!alertContainer) {
        // Créer un conteneur d'alerte si nécessaire
        alertContainer = document.createElement('div');
        alertContainer.id = 'alert-container';
        alertContainer.style.position = 'fixed';
        alertContainer.style.top = '20px';
        alertContainer.style.right = '20px';
        alertContainer.style.zIndex = '9999';
        document.body.appendChild(alertContainer);
    }
    
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show shadow`;
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Fermer"></button>
    `;
    
    alertContainer.innerHTML = '';
    alertContainer.appendChild(alert);
    
    // Auto-suppression après 5 secondes
    setTimeout(() => {
        if (alert.parentNode) {
            alert.remove();
        }
    }, 5000);
}*/




function afficherAlerte(message, type) {
    let alertContainer = document.getElementById('alert-container');
    if (!alertContainer) {
        alertContainer = document.createElement('div');
        alertContainer.id = 'alert-container';
        Object.assign(alertContainer.style, { position: 'fixed', top: '20px', right: '20px', zIndex: '9999' });
        document.body.appendChild(alertContainer);
    }
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show shadow`;
    alert.innerHTML = `${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Fermer"></button>`;
    alertContainer.innerHTML = '';
    alertContainer.appendChild(alert);
    setTimeout(() => { if (alert.parentNode) alert.remove(); }, 5000);
}









/*// Vérifier si l'utilisateur est déjà connecté
async function verifierConnexionExistante() {
    if (!supabase1) return;
    
    try {
        const { data: { session } } = await supabase1.auth.getSession();
        
        if (session && session.user) {
            console.log('👤 Utilisateur déjà connecté, redirection vers l\'accueil');
            window.location.href = 'home.html?session=active';
        }
    } catch (error) {
        console.warn('Erreur vérification session existante:', error);
    }
}*/


async function verifierConnexionExistante() {
    if (!supabase1) return;
    try {
        const { data: { session } } = await supabase1.auth.getSession();
        if (session?.user) {
            console.log("👤 Utilisateur déjà connecté, redirection...");
            window.location.href = 'home.html?session=active';
        }
    } catch (error) {
        console.warn('Erreur vérification session existante:', error);
    }
}




// ============================================
// PAGE CONNEXION - PARTIE À AJOUTER
// ============================================

// Variables supplémentaires pour la réinitialisation
let resetStep = 1; // 1 = formulaire email, 2 = confirmation


// Remplacer la fonction afficherModalResetPassword existante par celle-ci
/*function afficherModalResetPassword() {
    const emailInput = document.getElementById('email');
    const resetEmail = document.getElementById('reset-email');
    const modalBody = document.querySelector('#resetPasswordModal .modal-body');
    const modalFooter = document.querySelector('#resetPasswordModal .modal-footer');
    
    if (emailInput && resetEmail) {
        resetEmail.value = emailInput.value;
    }
    
    // Réinitialiser l'affichage du modal à l'étape 1
    resetStep = 1;
    mettreAJourModalReset();
    
    if (resetPasswordModal) {
        resetPasswordModal.show();
    }
}*/

/*// Nouvelle fonction pour mettre à jour l'affichage du modal
function mettreAJourModalReset() {
    const modalBody = document.querySelector('#resetPasswordModal .modal-body');
    const modalFooter = document.querySelector('#resetPasswordModal .modal-footer');
    
    if (!modalBody || !modalFooter) return;
    
    if (resetStep === 1) {
        // Étape 1 : Formulaire email
        modalBody.innerHTML = `
            <p class="text-muted small mb-3">
                Saisissez votre adresse email pour recevoir un lien de réinitialisation.
            </p>
            <div class="mb-3">
                <label for="reset-email" class="form-label">Adresse email</label>
                <div class="input-group">
                    <span class="input-group-text">
                        <i class="fa fa-envelope"></i>
                    </span>
                    <input 
                        type="email" 
                        class="form-control" 
                        id="reset-email" 
                        placeholder="votre@email.com"
                        autocomplete="email"
                        value="${document.getElementById('email')?.value || ''}"
                    >
                </div>
            </div>
        `;
        
        modalFooter.innerHTML = `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                <i class="fa fa-times me-1"></i> Annuler
            </button>
            <button type="button" class="btn btn-primary" id="btn-send-reset">
                <span id="reset-text">Envoyer</span>
                <span id="reset-spinner" class="spinner-border spinner-border-sm d-none" role="status"></span>
            </button>
        `;
        
        // Réattacher l'événement
        document.getElementById('btn-send-reset')?.addEventListener('click', envoyerResetPassword);
        
    } else if (resetStep === 2) {
        // Étape 2 : Confirmation
        const email = document.getElementById('reset-email')?.value || '';
        
        modalBody.innerHTML = `
            <div class="text-center">
                <div style="font-size: 4rem; color: #28a745; margin-bottom: 15px;">
                    <i class="fas fa-check-circle"></i>
                </div>
                <h5 class="mb-3">Email envoyé !</h5>
                <p class="text-muted mb-2">
                    Un email de réinitialisation a été envoyé à :
                </p>
                <div style="background: #e8f0fe; padding: 12px; border-radius: 8px; font-weight: 600; color: #4361ee; word-break: break-all; margin: 15px 0;">
                    ${email}
                </div>
                <p class="small text-muted mt-3">
                    <i class="fas fa-clock me-1"></i>
                    Le lien expire dans 1 heure. Vérifiez vos spams si vous ne trouvez pas l'email.
                </p>
            </div>
        `;
        
        modalFooter.innerHTML = `
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">
                <i class="fa fa-check me-1"></i> Fermer
            </button>
        `;
    }
}*/



function afficherModalResetPassword() {
    resetStep = 1;
    mettreAJourModalReset();
    if (resetPasswordModal) resetPasswordModal.show();
}

function mettreAJourModalReset() {
    const modalBody   = document.querySelector('#resetPasswordModal .modal-body');
    const modalFooter = document.querySelector('#resetPasswordModal .modal-footer');
    if (!modalBody || !modalFooter) return;

    if (resetStep === 1) {
        const emailPrefill = document.getElementById('email')?.value || '';

        modalBody.innerHTML = `
            <p class="text-muted small mb-3">
                Saisissez votre adresse email pour recevoir un lien de réinitialisation.
            </p>
            <div class="mb-3">
                <label for="reset-email" class="form-label">Adresse email</label>
                <div class="input-group">
                    <span class="input-group-text"><i class="fa fa-envelope"></i></span>
                    <input type="email" class="form-control" id="reset-email"
                           placeholder="votre@email.com" autocomplete="email"
                           value="${emailPrefill}">
                </div>
            </div>`;

        modalFooter.innerHTML = `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                <i class="fa fa-times me-1"></i> Annuler
            </button>
            <button type="button" class="btn btn-primary" id="btn-send-reset">
                <span id="reset-text"><i class="fa fa-paper-plane me-1"></i> Envoyer</span>
                <span id="reset-spinner" class="spinner-border spinner-border-sm d-none" role="status"></span>
            </button>`;

        // Entrée dans le champ → soumettre
        document.getElementById('reset-email')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') envoyerResetPassword();
        });
        document.getElementById('btn-send-reset')?.addEventListener('click', envoyerResetPassword);

    } else {
        // Étape 2 : confirmation
        const email = document.getElementById('reset-email')?.value || '';
        modalBody.innerHTML = `
            <div class="text-center">
                <div style="font-size:4rem;color:#28a745;margin-bottom:15px;">
                    <i class="fas fa-check-circle"></i>
                </div>
                <h5 class="mb-3">Email envoyé !</h5>
                <p class="text-muted mb-2">Un lien de réinitialisation a été envoyé à :</p>
                <div style="background:#e8f0fe;padding:12px;border-radius:8px;font-weight:600;
                            color:#4361ee;word-break:break-all;margin:15px 0;">
                    ${email}
                </div>
                <p class="small text-muted mt-3">
                    <i class="fas fa-clock me-1"></i>
                    Le lien expire dans 1 heure. Vérifiez vos spams si vous ne le trouvez pas.
                </p>
            </div>`;

        modalFooter.innerHTML = `
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">
                <i class="fa fa-check me-1"></i> Fermer
            </button>`;
    }
}







// Remplacer la fonction envoyerResetPassword existante par celle-ci (améliorée)
async function envoyerResetPassword() {
    if (!supabase1) return;
    
    const resetEmail = document.getElementById('reset-email');
    const btnSendReset = document.getElementById('btn-send-reset');
    const resetText = document.getElementById('reset-text');
    const resetSpinner = document.getElementById('reset-spinner');
    
    if (!resetEmail || !btnSendReset) return;
    
    const email = resetEmail.value.trim();
    
    if (!email || !validerEmail(email)) {
        afficherAlerte('Veuillez saisir une adresse email valide.', 'danger');
        return;
    }

    try {
        // Désactiver le bouton
        btnSendReset.disabled = true;
        if (resetText) resetText.classList.add('d-none');
        if (resetSpinner) resetSpinner.classList.remove('d-none');

        console.log('📧 Envoi de la demande de réinitialisation pour:', email);
        
        const { error } = await supabase1.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password.html`
        });

        if (error) throw error;

        console.log('✅ Email de réinitialisation envoyé avec succès');
        
        // Passer à l'étape 2 (confirmation)
        resetStep = 2;
        mettreAJourModalReset();
        
        // Sauvegarder l'email
        localStorage.setItem('remembered_email', email);
        
    } catch (error) {
        console.error('❌ Erreur réinitialisation:', error);
        
        let message = "Erreur lors de l'envoi de l'email";
        if (error.message.includes('Email not found')) {
            message = "Aucun compte trouvé avec cette adresse email";
        } else if (error.message.includes('rate limit')) {
            message = "Trop de tentatives. Veuillez réessayer dans quelques minutes.";
        }
        
        afficherAlerte(message, 'danger');
        
        // Réactiver le bouton
        btnSendReset.disabled = false;
        if (resetText) resetText.classList.remove('d-none');
        if (resetSpinner) resetSpinner.classList.add('d-none');
    }
}




























////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////



/*// ============================================
// PAGE CONNEXION
// ============================================

let resetPasswordModal = null;
let connexionLoading   = false;
let resetStep          = 1;

function initialiserPageConnexion() {
    console.log('🔑 Initialisation page de connexion...');
    initialiserEvenementsConnexion();
    activerValidationFormulaire();
    chargerEmailMemoire();
    verifierConnexionExistante();

    const modalElement = document.getElementById('resetPasswordModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        resetPasswordModal = new bootstrap.Modal(modalElement);
    }
}

function initialiserEvenementsConnexion() {
    // Toggle mot de passe
    const togglePassword = document.getElementById('toggle-password');
    if (togglePassword) {
        togglePassword.addEventListener('click', function() {
            const passwordInput = document.getElementById('password');
            const icon = this.querySelector('i');
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                passwordInput.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    }

    // Formulaire de connexion
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            connexion();
        });
    }

    // Lien "mot de passe oublié"
    const forgotPassword = document.getElementById('forgot-password');
    if (forgotPassword) {
        forgotPassword.addEventListener('click', function(e) {
            e.preventDefault();
            afficherModalResetPassword();
        });
    }

    // Mémoriser l'email
    const emailInput = document.getElementById('email');
    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            if (this.value.trim()) localStorage.setItem('remembered_email', this.value.trim());
        });
    }
}

function chargerEmailMemoire() {
    const rememberedEmail = localStorage.getItem('remembered_email');
    if (rememberedEmail) {
        const emailInput = document.getElementById('email');
        if (emailInput) {
            emailInput.value = rememberedEmail;
            emailInput.dispatchEvent(new Event('input'));
        }
    }
}

function activerValidationFormulaire() {
    const emailInput    = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const btnLogin      = document.getElementById('btn-login');
    if (!emailInput || !passwordInput || !btnLogin) return;

    const check = () => {
        btnLogin.disabled = !emailInput.value.trim() || !passwordInput.value.trim();
    };
    emailInput.addEventListener('input', check);
    passwordInput.addEventListener('input', check);
}

// ── Connexion ──────────────────────────────────────────────────────────────
async function connexion() {
    if (connexionLoading || !supabase1) return;

    const emailInput    = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    if (!emailInput || !passwordInput) return;

    const email    = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) { afficherAlerte('Veuillez remplir tous les champs.', 'danger'); return; }
    if (!validerEmail(email)) { afficherAlerte('Veuillez saisir une adresse email valide.', 'danger'); return; }

    setConnexionLoading(true);
    try {
        console.log('🔄 Tentative de connexion pour:', email);

        const { data, error } = await supabase1.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const user = data.user;
        if (!user) throw new Error('Erreur de connexion');

        console.log('✅ Connexion auth réussie, user ID:', user.id);
        localStorage.setItem('remembered_email', email);

        const profil = await verifierOuCreerProfil(user);
        if (!profil) {
            await supabase1.auth.signOut();
            throw new Error('Erreur de configuration du profil');
        }

        afficherAlerte(`Bienvenue ${profil.nom || email.split('@')[0]} !`, 'success');
        await new Promise(resolve => setTimeout(resolve, 1500));

        const { data: { session: sessionVerifiee } } = await supabase1.auth.getSession();
        if (!sessionVerifiee) throw new Error('Session non établie, veuillez réessayer');

        console.log('✅ Session vérifiée, redirection...');
        setTimeout(() => {
            window.location.href = 'home.html?connexion=success&t=' + Date.now();
        }, 2000);

    } catch (error) {
        console.error('❌ Erreur de connexion:', error);
        let msg = 'Erreur de connexion';
        if (error.message.includes('Invalid login credentials')) msg = 'Email ou mot de passe incorrect';
        else if (error.message.includes('Email not confirmed'))  msg = 'Veuillez confirmer votre email. Vérifiez votre boîte de réception.';
        else if (error.message.includes('Session non établie'))  msg = 'Problème de session, veuillez réessayer';
        else msg = error.message;
        afficherAlerte(msg, 'danger');
    } finally {
        setConnexionLoading(false);
    }
}

async function verifierOuCreerProfil(user) {
    if (!supabase1) return null;
    try {
        const { data: existingUser, error: selectError } = await supabase1
            .from('utilisateurs').select('*').eq('id', user.id).maybeSingle();

        if (selectError) console.warn('Erreur vérification utilisateur:', selectError);
        if (existingUser) return existingUser;

        console.log('🆕 Création du profil utilisateur...');
        const nom       = user.user_metadata?.nom || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Utilisateur';
        const telephone = user.user_metadata?.telephone || '';

        const { data: insertedUser, error: insertError } = await supabase1
            .from('utilisateurs')
            .insert([{ id: user.id, email: user.email, nom, telephone, roles: ['acheteur', 'vendeur'],
                       date_inscription: new Date().toISOString(), avatar: null,
                       note_moyenne: 0, nombre_ventes: 0, nombre_achats: 0 }])
            .select().single();

        if (insertError) {
            console.error('❌ Erreur création profil:', insertError);
            if (insertError.code === '23505') {
                const { data: retryUser } = await supabase1.from('utilisateurs').select('*').eq('id', user.id).maybeSingle();
                if (retryUser) return retryUser;
            }
            return null;
        }
        return insertedUser;

    } catch (error) {
        console.error('❌ Erreur profil:', error);
        return null;
    }
}

// ── Réinitialisation mot de passe ──────────────────────────────────────────

function afficherModalResetPassword() {
    resetStep = 1;
    mettreAJourModalReset();
    if (resetPasswordModal) resetPasswordModal.show();
}

function mettreAJourModalReset() {
    const modalBody   = document.querySelector('#resetPasswordModal .modal-body');
    const modalFooter = document.querySelector('#resetPasswordModal .modal-footer');
    if (!modalBody || !modalFooter) return;

    if (resetStep === 1) {
        const emailPrefill = document.getElementById('email')?.value || '';

        modalBody.innerHTML = `
            <p class="text-muted small mb-3">
                Saisissez votre adresse email pour recevoir un lien de réinitialisation.
            </p>
            <div class="mb-3">
                <label for="reset-email" class="form-label">Adresse email</label>
                <div class="input-group">
                    <span class="input-group-text"><i class="fa fa-envelope"></i></span>
                    <input type="email" class="form-control" id="reset-email"
                           placeholder="votre@email.com" autocomplete="email"
                           value="${emailPrefill}">
                </div>
            </div>`;

        modalFooter.innerHTML = `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                <i class="fa fa-times me-1"></i> Annuler
            </button>
            <button type="button" class="btn btn-primary" id="btn-send-reset">
                <span id="reset-text"><i class="fa fa-paper-plane me-1"></i> Envoyer</span>
                <span id="reset-spinner" class="spinner-border spinner-border-sm d-none" role="status"></span>
            </button>`;

        // Entrée dans le champ → soumettre
        document.getElementById('reset-email')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') envoyerResetPassword();
        });
        document.getElementById('btn-send-reset')?.addEventListener('click', envoyerResetPassword);

    } else {
        // Étape 2 : confirmation
        const email = document.getElementById('reset-email')?.value || '';
        modalBody.innerHTML = `
            <div class="text-center">
                <div style="font-size:4rem;color:#28a745;margin-bottom:15px;">
                    <i class="fas fa-check-circle"></i>
                </div>
                <h5 class="mb-3">Email envoyé !</h5>
                <p class="text-muted mb-2">Un lien de réinitialisation a été envoyé à :</p>
                <div style="background:#e8f0fe;padding:12px;border-radius:8px;font-weight:600;
                            color:#4361ee;word-break:break-all;margin:15px 0;">
                    ${email}
                </div>
                <p class="small text-muted mt-3">
                    <i class="fas fa-clock me-1"></i>
                    Le lien expire dans 1 heure. Vérifiez vos spams si vous ne le trouvez pas.
                </p>
            </div>`;

        modalFooter.innerHTML = `
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">
                <i class="fa fa-check me-1"></i> Fermer
            </button>`;
    }
}

// ✅ Utilise le système natif Supabase — pas de table custom, pas de Resend
async function envoyerResetPassword() {
    if (!supabase1) return;

    const resetEmailInput = document.getElementById('reset-email');
    const btnSendReset    = document.getElementById('btn-send-reset');
    const resetText       = document.getElementById('reset-text');
    const resetSpinner    = document.getElementById('reset-spinner');
    if (!resetEmailInput) return;

    const email = resetEmailInput.value.trim();
    if (!email || !validerEmail(email)) {
        afficherAlerte('Veuillez saisir une adresse email valide.', 'danger');
        return;
    }

    if (btnSendReset)  btnSendReset.disabled = true;
    if (resetText)     resetText.classList.add('d-none');
    if (resetSpinner)  resetSpinner.classList.remove('d-none');

    try {
        console.log('📧 Envoi du lien de réinitialisation pour:', email);

        // ✅ Supabase envoie lui-même l'email avec un lien sécurisé
        // Le token_hash sera présent dans l'URL de redirection
        const { error } = await supabase1.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password.html`,
        });

        if (error) throw error;

        console.log('✅ Email de réinitialisation envoyé');
        localStorage.setItem('remembered_email', email);

        // Passer à l'étape de confirmation
        resetStep = 2;
        mettreAJourModalReset();

    } catch (error) {
        console.error('❌ Erreur reset:', error);

        let msg = "Erreur lors de l'envoi de l'email";
        if (error.message.includes('rate limit')) {
            msg = "Trop de tentatives. Veuillez réessayer dans quelques minutes.";
        } else if (error.message) {
            msg = error.message;
        }
        afficherAlerte(msg, 'danger');

        if (btnSendReset)  btnSendReset.disabled = false;
        if (resetText)     resetText.classList.remove('d-none');
        if (resetSpinner)  resetSpinner.classList.add('d-none');
    }
}

// ── Utilitaires ────────────────────────────────────────────────────────────

function validerEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function setConnexionLoading(loading) {
    connexionLoading = loading;
    const btnLogin     = document.getElementById('btn-login');
    const loginText    = document.getElementById('login-text');
    const loginSpinner = document.getElementById('login-spinner');
    if (!btnLogin || !loginText || !loginSpinner) return;
    btnLogin.disabled = loading;
    if (loading) {
        loginText.classList.add('d-none');
        loginSpinner.classList.remove('d-none');
    } else {
        loginText.classList.remove('d-none');
        loginSpinner.classList.add('d-none');
    }
}

function afficherAlerte(message, type) {
    let alertContainer = document.getElementById('alert-container');
    if (!alertContainer) {
        alertContainer = document.createElement('div');
        alertContainer.id = 'alert-container';
        Object.assign(alertContainer.style, { position: 'fixed', top: '20px', right: '20px', zIndex: '9999' });
        document.body.appendChild(alertContainer);
    }
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show shadow`;
    alert.innerHTML = `${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Fermer"></button>`;
    alertContainer.innerHTML = '';
    alertContainer.appendChild(alert);
    setTimeout(() => { if (alert.parentNode) alert.remove(); }, 5000);
}

async function verifierConnexionExistante() {
    if (!supabase1) return;
    try {
        const { data: { session } } = await supabase1.auth.getSession();
        if (session?.user) {
            console.log("👤 Utilisateur déjà connecté, redirection...");
            window.location.href = 'home.html?session=active';
        }
    } catch (error) {
        console.warn('Erreur vérification session existante:', error);
    }
}
*/












































////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////









































// ============================================
// PAGE INSCRIPTION
// ============================================

// Variables pour la page d'inscription
let inscriptionLoading = false;

// Initialiser la page d'inscription
function initialiserPageInscription() {
    console.log('📝 Initialisation page inscription...');
    
    // Initialiser les événements
    initialiserEvenementsInscription();
    
    // Vérifier si l'utilisateur est déjà connecté
    verifierConnexionExistanteInscription();
}

// Initialiser les événements de la page d'inscription
function initialiserEvenementsInscription() {
    // Toggle mot de passe
    const togglePassword = document.getElementById('togglePassword');
    if (togglePassword) {
        togglePassword.addEventListener('click', function() {
            const passwordInput = document.getElementById('password');
            const icon = this.querySelector('i');
            
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                passwordInput.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    }

    // Toggle confirmation mot de passe
    const toggleConfirm = document.getElementById('toggleConfirmPassword');
    if (toggleConfirm) {
        toggleConfirm.addEventListener('click', function() {
            const confirmInput = document.getElementById('confirmPassword');
            const icon = this.querySelector('i');
            
            if (confirmInput.type === 'password') {
                confirmInput.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                confirmInput.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    }

    // Validation du mot de passe en temps réel
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.addEventListener('input', function() {
            verifierForceMotDePasse(this.value);
            verifierMotsDePasseCorrespondent();
            verifierFormulaireValide();
        });
    }

    // Validation de la confirmation
    const confirmInput = document.getElementById('confirmPassword');
    if (confirmInput) {
        confirmInput.addEventListener('input', function() {
            verifierMotsDePasseCorrespondent();
            verifierFormulaireValide();
        });
    }

    // Validation des autres champs
    const inputs = ['nomComplet', 'email', 'acceptTerms'];
    inputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', verifierFormulaireValide);
            if (element.type === 'checkbox') {
                element.addEventListener('change', verifierFormulaireValide);
            }
        }
    });

    // Soumission du formulaire
    const inscriptionForm = document.getElementById('inscriptionForm');
    if (inscriptionForm) {
        inscriptionForm.addEventListener('submit', function(e) {
            e.preventDefault();
            inscrireUtilisateur();
        });
    }

    // Inscription avec Google
    const googleBtn = document.getElementById('googleSignIn');
    if (googleBtn) {
        googleBtn.addEventListener('click', inscrireAvecGoogle);
    }
}

// Vérifier la force du mot de passe
function verifierForceMotDePasse(password) {
    const strengthBar = document.getElementById('passwordStrength');
    if (!strengthBar) return;
    
    // Réinitialiser les classes
    strengthBar.className = 'password-strength';
    
    // Vérifier les critères
    const hasLength = password.length >= 6;
    const hasNumber = /[0-9]/.test(password);
    const hasLower = /[a-z]/.test(password);
    
    // Mettre à jour les icônes des exigences
    updateRequirement('reqLength', hasLength);
    updateRequirement('reqNumber', hasNumber);
    updateRequirement('reqLower', hasLower);
    
    // Calculer la force
    const score = (hasLength ? 1 : 0) + (hasNumber ? 1 : 0) + (hasLower ? 1 : 0);
    
    if (password.length === 0) {
        strengthBar.className = 'password-strength';
    } else if (score <= 1) {
        strengthBar.className = 'password-strength strength-weak';
    } else if (score === 2) {
        strengthBar.className = 'password-strength strength-medium';
    } else {
        strengthBar.className = 'password-strength strength-strong';
    }
}

// Mettre à jour une exigence de mot de passe
function updateRequirement(elementId, isValid) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const icon = element.querySelector('i');
    if (isValid) {
        element.className = 'requirement-valid';
        icon.className = 'fas fa-check-circle';
    } else {
        element.className = 'requirement-invalid';
        icon.className = 'fas fa-times-circle';
    }
}

// Vérifier si les mots de passe correspondent
function verifierMotsDePasseCorrespondent() {
    const password = document.getElementById('password')?.value || '';
    const confirm = document.getElementById('confirmPassword')?.value || '';
    const matchMessage = document.getElementById('passwordMatch');
    
    if (!matchMessage) return true;
    
    if (confirm.length > 0 && password !== confirm) {
        matchMessage.classList.remove('d-none');
        return false;
    } else {
        matchMessage.classList.add('d-none');
        return password === confirm;
    }
}

// Vérifier si le formulaire est valide
function verifierFormulaireValide() {
    const nom = document.getElementById('nomComplet')?.value.trim() || '';
    const email = document.getElementById('email')?.value.trim() || '';
    const password = document.getElementById('password')?.value || '';
    const confirm = document.getElementById('confirmPassword')?.value || '';
    const acceptTerms = document.getElementById('acceptTerms')?.checked || false;
    const submitBtn = document.getElementById('submitBtn');
    
    if (!submitBtn) return false;
    
    // Vérifier tous les critères
    const emailValide = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const passwordValide = password.length >= 6 && 
                          /[0-9]/.test(password) && 
                          /[a-z]/.test(password);
    const motsDePasseCorrespondent = password === confirm;
    
    const formulaireValide = nom && 
                            emailValide && 
                            passwordValide && 
                            motsDePasseCorrespondent && 
                            acceptTerms;
    
    submitBtn.disabled = !formulaireValide;
    
    return formulaireValide;
}

// Afficher une alerte (version spécifique inscription)
function afficherAlerteInscription(message, type) {
    let alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) {
        alertContainer = document.createElement('div');
        alertContainer.id = 'alertContainer';
        alertContainer.style.position = 'fixed';
        alertContainer.style.top = '20px';
        alertContainer.style.right = '20px';
        alertContainer.style.zIndex = '9999';
        document.body.appendChild(alertContainer);
    }
    
    const alert = document.createElement('div');
    alert.className = `alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show`;
    alert.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Fermer"></button>
    `;
    
    alertContainer.innerHTML = '';
    alertContainer.appendChild(alert);
    
    // Auto-suppression après 5 secondes pour les succès
    if (type === 'success') {
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 5000);
    }
}

// Changer l'état de chargement (avec variable spécifique)
function setChargementInscription(chargement) {
    inscriptionLoading = chargement;
    const btn = document.getElementById('submitBtn');
    const btnText = document.getElementById('btnText');
    const btnSpinner = document.getElementById('btnSpinner');
    
    if (!btn || !btnText || !btnSpinner) return;
    
    btn.disabled = chargement;
    
    if (chargement) {
        btnText.textContent = 'Création du compte...';
        btnSpinner.style.display = 'inline-block';
    } else {
        btnText.textContent = 'Créer mon compte';
        btnSpinner.style.display = 'none';
    }
}

// Inscription d'un nouvel utilisateur (double rôle)
async function inscrireUtilisateur() {
    if (inscriptionLoading || !supabase1) return;
    
    // Récupérer les valeurs
    const nom = document.getElementById('nomComplet')?.value.trim() || '';
    const telephone = document.getElementById('telephone')?.value.trim() || '';
    const email = document.getElementById('email')?.value.trim() || '';
    const password = document.getElementById('password')?.value || '';
    
    // Vérifier que le formulaire est valide
    if (!verifierFormulaireValide()) {
        afficherAlerteInscription('Veuillez remplir correctement tous les champs.', 'error');
        return;
    }

    setChargementInscription(true);

    try {
        console.log('🔄 Création du compte avec double rôle (acheteur + vendeur)...');
        
        // 1. Vérifier si l'utilisateur existe déjà
        const { data: existingUser, error: checkError } = await supabase1
            .from('utilisateurs')
            .select('id')
            .eq('email', email)
            .maybeSingle();

        if (checkError) throw checkError;

        if (existingUser) {
            afficherAlerteInscription('Cet email est déjà utilisé. Veuillez vous connecter.', 'error');
            setChargementInscription(false);
            return;
        }

        // 2. Créer l'utilisateur dans Auth
        const { data: authData, error: authError } = await supabase1.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    nom: nom,
                    telephone: telephone
                },
                emailRedirectTo: `${window.location.origin}/connexion.html?verified=true`
            }
        });

        if (authError) throw authError;
        
        if (!authData.user) {
            throw new Error('Erreur lors de la création du compte');
        }

        console.log('✅ Compte Auth créé, ID:', authData.user.id);

        // 3. Créer le profil avec les deux rôles (sans avatar)
        const { error: profileError } = await supabase1
            .from('utilisateurs')
            .insert({
                id: authData.user.id,
                email: email,
                nom: nom,
                telephone: telephone,
                roles: ['acheteur', 'vendeur'], // Double rôle !
                date_inscription: new Date().toISOString(),
                avatar: null, // Pas de photo de profil
                note_moyenne: 0,
                nombre_ventes: 0,
                nombre_achats: 0
            });

        if (profileError) {
            console.error('❌ Erreur création profil:', profileError);
            // Tentative de nettoyage
            await supabase1.auth.signOut();
            throw profileError;
        }

        console.log('✅ Profil utilisateur créé avec rôles acheteur + vendeur (avatar: null)');

        // Succès
        afficherAlerteInscription(
            'Compte créé avec succès ! Vous êtes maintenant acheteur ET vendeur. Vérifiez votre email pour activer votre compte.',
            'success'
        );

        // Redirection après délai
        setTimeout(() => {
            window.location.href = 'connexion.html?inscription=success';
        }, 3000);

    } catch (error) {
        console.error('❌ Erreur inscription:', error);
        
        let messageErreur = 'Erreur lors de l\'inscription';
        
        if (error.message.includes('User already registered')) {
            messageErreur = 'Cet email est déjà enregistré. Veuillez vous connecter.';
        } else if (error.message.includes('password')) {
            messageErreur = 'Le mot de passe ne respecte pas les critères de sécurité.';
        } else {
            messageErreur = error.message || 'Une erreur est survenue';
        }
        
        afficherAlerteInscription(messageErreur, 'error');
    } finally {
        setChargementInscription(false);
    }
}

// Inscription avec Google
async function inscrireAvecGoogle() {
    if (!supabase1) return;
    
    try {
        console.log('🔄 Tentative d\'inscription avec Google...');
        
        const { data, error } = await supabase1.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/connexion.html?google=success`,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                }
            }
        });

        if (error) throw error;
        
        // La redirection est gérée par Supabase
        console.log('✅ Redirection vers Google...');
        
    } catch (error) {
        console.error('❌ Erreur inscription Google:', error);
        afficherAlerteInscription('Erreur lors de l\'inscription avec Google: ' + error.message, 'error');
    }
}

// Gérer le retour de l'inscription Google
async function gererRetourGoogle() {
    if (!supabase1) return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const googleSuccess = urlParams.get('google');
    
    if (googleSuccess === 'success') {
        try {
            // Récupérer la session
            const { data: { session }, error } = await supabase1.auth.getSession();
            
            if (error || !session) {
                console.error('Pas de session après Google');
                return;
            }

            const user = session.user;
            
            // Vérifier si le profil existe déjà
            const { data: existingProfile } = await supabase1
                .from('utilisateurs')
                .select('id, roles')
                .eq('id', user.id)
                .maybeSingle();

            if (!existingProfile) {
                // Créer le profil avec les deux rôles (sans avatar)
                const nom = user.user_metadata?.full_name || 
                           user.user_metadata?.name || 
                           user.email?.split('@')[0] || 
                           'Utilisateur';
                
                const telephone = user.user_metadata?.phone || '';
                
                await supabase1
                    .from('utilisateurs')
                    .insert({
                        id: user.id,
                        email: user.email,
                        nom: nom,
                        telephone: telephone,
                        roles: ['acheteur', 'vendeur'], // Double rôle !
                        date_inscription: new Date().toISOString(),
                        avatar: null, // Pas de photo de profil
                        note_moyenne: 0,
                        nombre_ventes: 0,
                        nombre_achats: 0
                    });

                console.log('✅ Profil Google créé avec double rôle (avatar: null)');
            }

            // Rediriger vers l'accueil
            setTimeout(() => {
                window.location.href = 'home.html?google=welcome';
            }, 1500);

        } catch (error) {
            console.error('Erreur traitement Google:', error);
        }
    }
}

// Vérifier si l'utilisateur est déjà connecté
async function verifierConnexionExistanteInscription() {
    if (!supabase1) return;
    
    try {
        const { data: { session } } = await supabase1.auth.getSession();
        
        if (session && session.user) {
            console.log('👤 Utilisateur déjà connecté, redirection vers l\'accueil');
            window.location.href = 'home.html?session=active';
        }
    } catch (error) {
        console.warn('Erreur vérification session:', error);
    }
}

/*// ============================================
// FONCTIONS DE CALCUL DES FRAIS
// ============================================

function arrondi50(nombre) {
    return Math.ceil(nombre / 50) * 50;
}


function calculerFrais(prixArticle) {
    let fraisAcheteur = 0;
    let livraison = 0;
    
    if (prixArticle <= 1000) {
        fraisAcheteur = 100 + (prixArticle * 0.03);
        livraison = 300;
    } else if (prixArticle <= 5000) {
        fraisAcheteur = 150 + (prixArticle * 0.03);
        livraison = 500;
    } else if (prixArticle <= 10000) {
        fraisAcheteur = 200 + (prixArticle * 0.03);
        livraison = 700;
    } else if (prixArticle <= 20000) {
        fraisAcheteur = 300 + (prixArticle * 0.03);
        livraison = 1000;
    } else if (prixArticle <= 50000) {
        fraisAcheteur = 400 + (prixArticle * 0.03);
        livraison = 1500;
    } else if (prixArticle <= 100000) {
        fraisAcheteur = 500 + (prixArticle * 0.03);
        livraison = 2000;
    } else {
        fraisAcheteur = 1000 + (prixArticle * 0.03);
        livraison = 5000;
    }

    fraisAcheteur = arrondi50(fraisAcheteur);
    let total = arrondi50(prixArticle + fraisAcheteur + livraison);

    
    return {
        fraisAcheteur: Math.round(fraisAcheteur),
        livraison: livraison,
        //total: Math.round(prixArticle + fraisAcheteur + livraison)
        total: total
    };
}

// ============================================
// PAGE DÉTAIL ANNONCE - AVEC CARTE ET FRAIS
// ============================================

let detailLoading = false;
let produitActuel = null;
let vendeurActuel = null;
let imagesListe = [];
let achatModal = null;
let lightboxModal = null;
let map = null;
let marker = null;
let positionLivraison = null;

// Initialiser la page détail
function initialiserPageDetail() {
    console.log('🔍 Initialisation page détail annonce...');
    
    // Récupérer l'ID du produit depuis l'URL
    const urlParams = new URLSearchParams(window.location.search);
    const produitId = urlParams.get('id');
    
    if (!produitId) {
        afficherErreurDetail();
        return;
    }
    
    initialiserModalsDetail();
    verifierConnexionDetail(produitId);
    
    // Timeout de sécurité
    setTimeout(() => {
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator && !loadingIndicator.classList.contains('d-none')) {
            console.log('⏰ Timeout de chargement');
            afficherErreurDetail();
        }
    }, 10000);
}

// Initialiser les modals Bootstrap
function initialiserModalsDetail() {
    if (typeof bootstrap === 'undefined') return;
    
    const achatModalEl = document.getElementById('achatModal');
    const lightModal = document.getElementById('lightboxModal');
    
    if (achatModalEl) {
        achatModal = new bootstrap.Modal(achatModalEl);
    }
    if (lightModal) {
        lightboxModal = new bootstrap.Modal(lightModal);
    }
}

// Vérifier la connexion et charger le produit
async function verifierConnexionDetail(produitId) {
    try {
        const { data: { session }, error } = await supabase1.auth.getSession();
        
        if (error) throw error;
        
        if (session && session.user) {
            UTILISATEUR_COURANT = session.user.id;
            await chargerInfosUtilisateur();
            afficherUtilisateurConnecte();
        }
        
        // Charger le produit (connecté ou non)
        await chargerProduitDetail(produitId);
        
    } catch (error) {
        console.error('Erreur vérification connexion:', error);
        // Continuer sans utilisateur connecté
        await chargerProduitDetail(produitId);
    }
}

// Charger les détails du produit
async function chargerProduitDetail(produitId) {
    if (!supabase1) return;
    
    try {
        // Charger le produit avec les infos du vendeur
        const { data: produit, error } = await supabase1
            .from('produits')
            .select(`
                *,
                vendeur:utilisateurs!vendeur_id(*)
            `)
            .eq('id', produitId)
            .single();

        if (error) throw error;
        
        if (!produit) {
            afficherErreurDetail();
            return;
        }

        produitActuel = produit;
        vendeurActuel = produit.vendeur;

        // Charger les images (si stockées dans un tableau JSON)
        imagesListe = produit.images || [produit.image_url].filter(Boolean);

        // Afficher le produit
        afficherProduitDetail();

    } catch (error) {
        console.error('Erreur chargement produit:', error);
        afficherErreurDetail();
    }
}

// Afficher le produit
function afficherProduitDetail() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const annonceContent = document.getElementById('annonceContent');
    
    if (loadingIndicator) loadingIndicator.classList.add('d-none');
    if (annonceContent) annonceContent.classList.remove('d-none');

    // Afficher les images
    afficherImagesDetail();
    
    // Afficher les infos produit
    const productTitle = document.getElementById('productTitle');
    if (productTitle) productTitle.textContent = produitActuel.titre || 'Sans titre';
    
    const productPrice = document.getElementById('productPrice');
    if (productPrice) productPrice.textContent = formatPrixDetail(produitActuel.prix);
    
    // Afficher la description avec un meilleur formatage
    const productDescription = document.getElementById('productDescription');
    if (productDescription) {
        // Remplacer les retours à la ligne par des <br> et gérer le texte long
        const descriptionTexte = produitActuel.description || 'Aucune description disponible.';
        const descriptionHtml = descriptionTexte
            .replace(/\n/g, '<br>')
            .replace(/\r/g, '<br>')
            .replace(/\n\r/g, '<br>');
        productDescription.innerHTML = descriptionHtml;
    }
    
    // Afficher les métadonnées
    afficherMetaDetail();
    
    // Afficher la carte vendeur
    afficherVendeurDetail();
    
    // Afficher les détails techniques
    afficherDetailsTechniquesDetail();
    
    // Afficher les boutons d'action
    afficherBoutonsActionDetail();
    
    // Charger les produits similaires
    chargerProduitsSimilairesDetail();
}

// Afficher les images
function afficherImagesDetail() {
    const mainImage = document.getElementById('mainImage');
    const thumbnails = document.getElementById('thumbnails');
    
    if (!mainImage || !thumbnails) return;
    
    if (imagesListe.length > 0) {
        mainImage.src = imagesListe[0];
        
        thumbnails.innerHTML = '';
        imagesListe.forEach((img, index) => {
            const thumb = document.createElement('img');
            thumb.src = img;
            thumb.className = `thumbnail ${index === 0 ? 'active' : ''}`;
            thumb.onclick = () => changerImagePrincipaleDetail(img, index);
            thumb.onerror = () => { thumb.src = 'image/default-product.jpg'; };
            thumbnails.appendChild(thumb);
        });
    } else {
        mainImage.src = 'image/default-product.jpg';
    }
}

// Changer l'image principale
function changerImagePrincipaleDetail(src, index) {
    const mainImage = document.getElementById('mainImage');
    if (mainImage) mainImage.src = src;
    
    document.querySelectorAll('.thumbnail').forEach((thumb, i) => {
        thumb.classList.toggle('active', i === index);
    });
}

// Ouvrir la lightbox
function ouvrirLightboxDetail() {
    const mainImage = document.getElementById('mainImage');
    if (!mainImage) return;
    
    const lightboxImage = document.getElementById('lightboxImage');
    if (lightboxImage) lightboxImage.src = mainImage.src;
    
    if (lightboxModal) lightboxModal.show();
}

// Afficher les métadonnées
function afficherMetaDetail() {
    const meta = document.getElementById('productMeta');
    if (!meta || !produitActuel) return;
    
    const date = new Date(produitActuel.created_at);
    const maintenant = new Date();
    const diffHeures = Math.floor((maintenant - date) / (1000 * 60 * 60));
    
    let tempsAjout;
    if (diffHeures < 1) tempsAjout = "À l'instant";
    else if (diffHeures < 24) tempsAjout = `Il y a ${diffHeures} heure${diffHeures > 1 ? 's' : ''}`;
    else {
        const diffJours = Math.floor(diffHeures / 24);
        tempsAjout = `Il y a ${diffJours} jour${diffJours > 1 ? 's' : ''}`;
    }

    meta.innerHTML = `
        <div class="meta-item">
            <i class="fas fa-tag"></i>
            <span>${produitActuel.categorie || 'Non catégorisé'}</span>
        </div>
        <div class="meta-item">
            <i class="fas fa-clock"></i>
            <span>Ajouté ${tempsAjout}</span>
        </div>
        ${produitActuel.etat ? `
        <div class="meta-item">
            <i class="fas fa-star"></i>
            <span>${produitActuel.etat}</span>
        </div>
        ` : ''}
    `;
}

// Afficher la carte vendeur
function afficherVendeurDetail() {
    const container = document.getElementById('sellerCard');
    if (!container) return;
    
    if (!vendeurActuel) {
        container.innerHTML = '<p class="text-muted">Informations vendeur non disponibles</p>';
        return;
    }

    const initiales = vendeurActuel.nom ? 
        vendeurActuel.nom.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 
        'V';

    // Statistiques du vendeur
    const nbVentes = vendeurActuel.nombre_ventes || 0;
    const note = vendeurActuel.note_moyenne || 0;

    container.innerHTML = `
        <div class="seller-header">
            <div class="seller-avatar">${initiales}</div>
            <div class="seller-info">
                <div class="seller-name">${vendeurActuel.nom || 'Vendeur'}</div>
                
            </div>
        </div>
        <div class="seller-stats">
            <div class="stat">
                <div class="stat-value">${nbVentes}</div>
                <div class="stat-label">Ventes</div>
            </div>
            <div class="stat">
                <div class="stat-value">${vendeurActuel.telephone ? '✓' : '✗'}</div>
                <div class="stat-label">Téléphone</div>
            </div>
            <div class="stat">
                <div class="stat-value">${vendeurActuel.email ? '✓' : '✗'}</div>
                <div class="stat-label">Email</div>
            </div>
        </div>
    `;
}

// Générer des étoiles pour la note
function genererEtoilesDetail(note) {
    const noteNum = parseFloat(note);
    let etoiles = '';
    for (let i = 1; i <= 5; i++) {
        if (i <= Math.floor(noteNum)) {
            etoiles += '<i class="fas fa-star"></i>';
        } else if (i - 0.5 <= noteNum) {
            etoiles += '<i class="fas fa-star-half-alt"></i>';
        } else {
            etoiles += '<i class="far fa-star"></i>';
        }
    }
    return etoiles;
}

// Afficher les boutons d'action
function afficherBoutonsActionDetail() {
    const container = document.getElementById('actionButtons');
    if (!container || !produitActuel || !vendeurActuel) return;
    
    if (!UTILISATEUR_COURANT) {
        container.innerHTML = `
            <a href="connexion.html?redirect=detail&id=${produitActuel.id}" class="btn-acheter">
                <i class="fas fa-sign-in-alt me-2"></i>Connectez-vous pour acheter
            </a>
        `;
        return;
    }

    // Si c'est mon propre produit
    if (UTILISATEUR_COURANT === vendeurActuel?.id) {
        container.innerHTML = `
            <a href="mes-produits.html" class="btn-acheter">
                <i class="fas fa-box me-2"></i>Voir mes produits
            </a>
        `;
        return;
    }

    container.innerHTML = `
        <button class="btn-acheter" onclick="ouvrirAchatDetail()">
            <i class="fas fa-shopping-cart me-2"></i>Acheter directement
        </button>
    `;
}

// Afficher les détails techniques
function afficherDetailsTechniquesDetail() {
    const container = document.getElementById('detailsTechniques');
    if (!container || !produitActuel) return;
    
    // Adapter selon vos champs
    const details = [
        { label: 'Marque', valeur: produitActuel.marque || 'Non spécifiée' },
        { label: 'Modèle', valeur: produitActuel.modele || 'Non spécifié' },
        { label: 'Couleur', valeur: produitActuel.couleur || 'Non spécifiée' },
        { label: 'État', valeur: produitActuel.etat || 'Non spécifié' },
        { label: 'Référence', valeur: produitActuel.id.substring(0, 8) + '...' },
    ];

    container.innerHTML = `
        <h3 class="details-title">
            <i class="fas fa-info-circle me-2"></i>Détails du produit
        </h3>
        ${details.map(d => `
            <div class="detail-row">
                <div class="detail-label">${d.label}</div>
                <div class="detail-value">${d.valeur}</div>
            </div>
        `).join('')}
    `;
}

// Charger les produits similaires
async function chargerProduitsSimilairesDetail() {
    if (!supabase1 || !produitActuel) return;
    
    try {
        const { data, error } = await supabase1
            .from('produits')
            .select('*')
            .eq('categorie', produitActuel.categorie)
            .neq('id', produitActuel.id)
            .eq('est_actif', true)
            .limit(4);

        if (error) throw error;

        const container = document.getElementById('similarProducts');
        if (!container) return;

        if (!data || data.length === 0) {
            container.classList.add('d-none');
            return;
        }

        container.classList.remove('d-none');
        
        container.innerHTML = `
            <h3 class="similar-title">
                <i class="fas fa-tags me-2"></i>Produits similaires
            </h3>
            <div class="similar-grid">
                ${data.map(p => `
                    <div class="similar-card" onclick="window.location.href='detail-annonce.html?id=${p.id}'">
                        <img src="${p.image_url || 'image/default-product.jpg'}" 
                             alt="${p.titre}" 
                             class="similar-image"
                             onerror="this.src='image/default-product.jpg'">
                        <div class="similar-info">
                            <div class="similar-name">${p.titre || 'Sans titre'}</div>
                            <div class="similar-price">${formatPrixDetail(p.prix)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

    } catch (error) {
        console.error('Erreur chargement produits similaires:', error);
        const container = document.getElementById('similarProducts');
        if (container) container.classList.add('d-none');
    }
}

// Initialiser la carte de livraison
function initialiserCarteLivraison() {
    // Centre de Dakar
    const dakarCenter = [14.7167, -17.4677];
    
    if (map) {
        map.remove();
    }
    
    map = L.map('map').setView(dakarCenter, 12);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    // Limiter la vue à Dakar (approximativement)
    const dakarBounds = L.latLngBounds(
        L.latLng(14.6, -17.6), // Sud-Ouest
        L.latLng(14.8, -17.3)  // Nord-Est
    );
    map.setMaxBounds(dakarBounds);
    map.on('drag', function() {
        map.panInsideBounds(dakarBounds, { animate: false });
    });
    
    // Marqueur initial
    marker = L.marker(dakarCenter, { draggable: true }).addTo(map);
    marker.bindPopup('Déplacez-moi pour choisir votre position').openPopup();
    
    // Mettre à jour la position quand le marqueur est déplacé
    marker.on('dragend', function(e) {
        const pos = e.target.getLatLng();
        positionLivraison = [pos.lat, pos.lng];
        mettreAJourFraisLivraison();
    });
    
    // Clic sur la carte pour déplacer le marqueur
    map.on('click', function(e) {
        marker.setLatLng(e.latlng);
        positionLivraison = [e.latlng.lat, e.latlng.lng];
        mettreAJourFraisLivraison();
    });
    
    positionLivraison = dakarCenter;
    mettreAJourFraisLivraison();
}

// Mettre à jour l'affichage des frais
function mettreAJourFraisLivraison() {
    const frais = calculerFrais(produitActuel.prix);
    
    const fraisAcheteurEl = document.getElementById('fraisAcheteur');
    const fraisLivraisonEl = document.getElementById('fraisLivraison');
    const totalEl = document.getElementById('totalAvecFrais');
    
    if (fraisAcheteurEl) fraisAcheteurEl.textContent = frais.fraisAcheteur.toLocaleString() + ' FCFA';
    if (fraisLivraisonEl) fraisLivraisonEl.textContent = frais.livraison.toLocaleString() + ' FCFA';
    if (totalEl) totalEl.textContent = frais.total.toLocaleString() + ' FCFA';
}

// Ouvrir le modal d'achat avec carte
function ouvrirAchatDetail() {
    if (!UTILISATEUR_COURANT) {
        window.location.href = `connexion.html?redirect=detail&id=${produitActuel.id}`;
        return;
    }

    if (UTILISATEUR_COURANT === vendeurActuel?.id) {
        alert("Vous ne pouvez pas acheter votre propre produit");
        return;
    }

    const achatProductTitle = document.getElementById('achatProductTitle');
    if (achatProductTitle) achatProductTitle.textContent = produitActuel.titre;
    
    const achatProductPrice = document.getElementById('achatProductPrice');
    if (achatProductPrice) achatProductPrice.innerHTML = formatPrixDetail(produitActuel.prix);
    
    // Initialiser les frais
    const frais = calculerFrais(produitActuel.prix);
    document.getElementById('prixArticle').textContent = formatPrixDetail(produitActuel.prix);
    document.getElementById('fraisAcheteur').textContent = frais.fraisAcheteur.toLocaleString() + ' FCFA';
    document.getElementById('fraisLivraison').textContent = frais.livraison.toLocaleString() + ' FCFA';
    document.getElementById('totalAvecFrais').textContent = frais.total.toLocaleString() + ' FCFA';
    
    // Initialiser la carte
    setTimeout(() => {
        initialiserCarteLivraison();
    }, 500);
    
    if (achatModal) achatModal.show();
}

// Confirmer l'achat avec position de livraison
async function confirmerAchatDetail() {
    if (!supabase1 || !UTILISATEUR_COURANT || !produitActuel || !vendeurActuel) return;
    
    if (!positionLivraison) {
        alert('Veuillez sélectionner une position de livraison sur la carte');
        return;
    }
    
    try {
        // Vérifier que le produit est toujours disponible
        const { data: produit, error: checkError } = await supabase1
            .from('produits')
            .select('est_actif')
            .eq('id', produitActuel.id)
            .single();
            
        if (checkError) throw checkError;
        
        if (!produit.est_actif) {
            alert('Ce produit n\'est plus disponible à la vente');
            window.location.reload();
            return;
        }
        
        // Calculer les frais
        const frais = calculerFrais(produitActuel.prix);
        
        // Créer la commande dans la table commandes
        const codeUnique = genererCodeUniqueDetail();
        
        const commande = {
            code_unique: codeUnique,
            id_produit: produitActuel.id,
            id_acheteur: UTILISATEUR_COURANT,
            id_vendeur: vendeurActuel.id,
            prix: frais.total,
            latitude: positionLivraison[0],
            longitude: positionLivraison[1],
            telephone_client: userData?.telephone || '',
            etat: 'en attente de livraison',
            paiement_recu: false,
            created_at: new Date().toISOString()
        };

        const { error } = await supabase1
            .from('commandes')
            .insert([commande]);

        if (error) throw error;

        // Fermer le modal
        if (achatModal) achatModal.hide();
        
        // Afficher message de succès
        afficherMessageDetail('✅ Achat confirmé ! Votre commande a été enregistrée.', 'success');
        
        // Rediriger vers la page de confirmation
        setTimeout(() => {
            window.location.href = `historique_commande.html?success=${codeUnique}`;
        }, 2000);

    } catch (error) {
        console.error('Erreur achat:', error);
        afficherMessageDetail('❌ Erreur lors de l\'achat: ' + error.message, 'error');
    }
}

// Afficher une erreur
function afficherErreurDetail() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorState = document.getElementById('errorState');
    
    if (loadingIndicator) loadingIndicator.classList.add('d-none');
    if (errorState) errorState.classList.remove('d-none');
}

// Afficher un message
function afficherMessageDetail(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show position-fixed`;
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '1050';
    alertDiv.style.minWidth = '300px';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) alertDiv.remove();
    }, 5000);
}

// Formater le prix
function formatPrixDetail(prix) {
    if (!prix) return 'Prix non disponible';
    return prix.toLocaleString('fr-FR') + ' FCFA';
}

// Générer un code unique
function genererCodeUniqueDetail() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'CMD-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += '-' + Date.now().toString().slice(-4);
    return code;
}*/











// ============================================
// FONCTIONS DE CALCUL DES FRAIS
// ============================================

function arrondi50(nombre) {
    return Math.ceil(nombre / 50) * 50;
}

// 🔥 Fonction pour vérifier les commandes gratuites restantes
async function verifierCommandesGratuites() {
    if (!UTILISATEUR_COURANT || !supabase1) return 0;
    
    try {
        const { data, error } = await supabase1
            .from('utilisateurs')
            .select('gratuit')
            .eq('id', UTILISATEUR_COURANT)
            .single();
            
        if (error) throw error;
        
        return data?.gratuit || 0;
    } catch (error) {
        console.error('❌ Erreur vérification commandes gratuites:', error);
        return 0;
    }
}

// 🔥 Fonction de calcul des frais avec prise en compte des commandes gratuites
async function calculerFraisAvecGratuit(prixArticle) {
    const commandesGratuites = await verifierCommandesGratuites();
    
    // Si l'utilisateur a encore des commandes gratuites (gratuit > 0)
    if (commandesGratuites > 0) {
        return {
            fraisAcheteur: 0,
            livraison: 0,
            total: prixArticle,
            gratuit: true
        };
    }
    
    // Sinon, calcul normal (gratuit = 0)
    let fraisAcheteur = 0;
    let livraison = 0;
    
    if (prixArticle <= 1000) {
        fraisAcheteur = 90 + (prixArticle * 0.03);
        livraison = 300;
    } else if (prixArticle <= 5000) {
        fraisAcheteur = 90 + (prixArticle * 0.03);
        livraison = 500;
    } else if (prixArticle <= 10000) {
        fraisAcheteur = 90 + (prixArticle * 0.03);
        livraison = 700;
    } else if (prixArticle <= 20000) {
        fraisAcheteur = 90 + (prixArticle * 0.03);
        livraison = 1000;
    } else if (prixArticle <= 50000) {
        fraisAcheteur = 100 + (prixArticle * 0.03);
        livraison = 1500;
    } else if (prixArticle <= 100000) {
        fraisAcheteur = 120 + (prixArticle * 0.03);
        livraison = 2000;
    } else {
        fraisAcheteur = 800 + (prixArticle * 0.03);
        livraison = 3500;
    }

    fraisAcheteur = arrondi50(fraisAcheteur);
    let total = arrondi50(prixArticle + fraisAcheteur + livraison);
    
    return {
        fraisAcheteur: Math.round(fraisAcheteur),
        livraison: livraison,
        total: total,
        gratuit: false
    };
}


// Fonction synchrone pour les affichages statiques (conservée pour compatibilité)
function calculerFrais(prixArticle) {
    let fraisAcheteur = 0;
    let livraison = 0;
    
    if (prixArticle <= 1000) {
        fraisAcheteur = 90 + (prixArticle * 0.03);
        livraison = 300;
    } else if (prixArticle <= 5000) {
        fraisAcheteur = 90 + (prixArticle * 0.03);
        livraison = 500;
    } else if (prixArticle <= 10000) {
        fraisAcheteur = 90 + (prixArticle * 0.03);
        livraison = 700;
    } else if (prixArticle <= 20000) {
        fraisAcheteur = 90 + (prixArticle * 0.03);
        livraison = 1000;
    } else if (prixArticle <= 50000) {
        fraisAcheteur = 100 + (prixArticle * 0.03);
        livraison = 1500;
    } else if (prixArticle <= 100000) {
        fraisAcheteur = 120 + (prixArticle * 0.03);
        livraison = 2000;
    } else {
        fraisAcheteur = 800 + (prixArticle * 0.03);
        livraison = 3500;
    }

    fraisAcheteur = arrondi50(fraisAcheteur);
    let total = arrondi50(prixArticle + fraisAcheteur + livraison);

    return {
        fraisAcheteur: Math.round(fraisAcheteur),
        livraison: livraison,
        total: total
    };
}

// ============================================
// PAGE DÉTAIL ANNONCE - AVEC CARTE ET FRAIS
// ============================================

let detailLoading = false;
let produitActuel = null;
let vendeurActuel = null;
let imagesListe = [];
let achatModal = null;
let lightboxModal = null;
let map = null;
let marker = null;
let positionLivraison = null;

// Initialiser la page détail
function initialiserPageDetail() {
    console.log('🔍 Initialisation page détail annonce...');
    
    // Récupérer l'ID du produit depuis l'URL
    const urlParams = new URLSearchParams(window.location.search);
    const produitId = urlParams.get('id');
    
    if (!produitId) {
        afficherErreurDetail();
        return;
    }
    
    initialiserModalsDetail();
    verifierConnexionDetail(produitId);
    
    // Timeout de sécurité
    setTimeout(() => {
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator && !loadingIndicator.classList.contains('d-none')) {
            console.log('⏰ Timeout de chargement');
            afficherErreurDetail();
        }
    }, 10000);
}

// Initialiser les modals Bootstrap
function initialiserModalsDetail() {
    if (typeof bootstrap === 'undefined') return;
    
    const achatModalEl = document.getElementById('achatModal');
    const lightModal = document.getElementById('lightboxModal');
    
    if (achatModalEl) {
        achatModal = new bootstrap.Modal(achatModalEl);
    }
    if (lightModal) {
        lightboxModal = new bootstrap.Modal(lightModal);
    }
}

// Vérifier la connexion et charger le produit
async function verifierConnexionDetail(produitId) {
    try {
        const { data: { session }, error } = await supabase1.auth.getSession();
        
        if (error) throw error;
        
        if (session && session.user) {
            UTILISATEUR_COURANT = session.user.id;
            await chargerInfosUtilisateur();
            afficherUtilisateurConnecte();
        }
        
        // Charger le produit (connecté ou non)
        await chargerProduitDetail(produitId);
        
    } catch (error) {
        console.error('Erreur vérification connexion:', error);
        // Continuer sans utilisateur connecté
        await chargerProduitDetail(produitId);
    }
}

// Charger les détails du produit
async function chargerProduitDetail(produitId) {
    if (!supabase1) return;
    
    try {
        // Charger le produit avec les infos du vendeur
        const { data: produit, error } = await supabase1
            .from('produits')
            .select(`
                *,
                vendeur:utilisateurs!vendeur_id(*)
            `)
            .eq('id', produitId)
            .single();

        if (error) throw error;
        
        if (!produit) {
            afficherErreurDetail();
            return;
        }

        produitActuel = produit;
        vendeurActuel = produit.vendeur;

        // Charger les images (si stockées dans un tableau JSON)
        imagesListe = produit.images || [produit.image_url].filter(Boolean);

        // Afficher le produit
        afficherProduitDetail();

    } catch (error) {
        console.error('Erreur chargement produit:', error);
        afficherErreurDetail();
    }
}

// Afficher le produit
function afficherProduitDetail() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const annonceContent = document.getElementById('annonceContent');
    
    if (loadingIndicator) loadingIndicator.classList.add('d-none');
    if (annonceContent) annonceContent.classList.remove('d-none');

    // Afficher les images
    afficherImagesDetail();
    
    // Afficher les infos produit
    const productTitle = document.getElementById('productTitle');
    if (productTitle) productTitle.textContent = produitActuel.titre || 'Sans titre';
    
    const productPrice = document.getElementById('productPrice');
    if (productPrice) productPrice.textContent = formatPrixDetail(produitActuel.prix);
    
    // Afficher la description avec un meilleur formatage
    const productDescription = document.getElementById('productDescription');
    if (productDescription) {
        const descriptionTexte = produitActuel.description || 'Aucune description disponible.';
        const descriptionHtml = descriptionTexte
            .replace(/\n/g, '<br>')
            .replace(/\r/g, '<br>')
            .replace(/\n\r/g, '<br>');
        productDescription.innerHTML = descriptionHtml;
    }
    
    // Afficher les métadonnées
    afficherMetaDetail();
    
    // Afficher la carte vendeur
    afficherVendeurDetail();
    
    // Afficher les détails techniques
    afficherDetailsTechniquesDetail();
    
    // Afficher les boutons d'action
    afficherBoutonsActionDetail();
    
    // Charger les produits similaires
    chargerProduitsSimilairesDetail();
}

// Afficher les images
function afficherImagesDetail() {
    const mainImage = document.getElementById('mainImage');
    const thumbnails = document.getElementById('thumbnails');
    
    if (!mainImage || !thumbnails) return;
    
    if (imagesListe.length > 0) {
        mainImage.src = imagesListe[0];
        
        thumbnails.innerHTML = '';
        imagesListe.forEach((img, index) => {
            const thumb = document.createElement('img');
            thumb.src = img;
            thumb.className = `thumbnail ${index === 0 ? 'active' : ''}`;
            thumb.onclick = () => changerImagePrincipaleDetail(img, index);
            thumb.onerror = () => { thumb.src = 'image/default-product.jpg'; };
            thumbnails.appendChild(thumb);
        });
    } else {
        mainImage.src = 'image/default-product.jpg';
    }
}

// Changer l'image principale
function changerImagePrincipaleDetail(src, index) {
    const mainImage = document.getElementById('mainImage');
    if (mainImage) mainImage.src = src;
    
    document.querySelectorAll('.thumbnail').forEach((thumb, i) => {
        thumb.classList.toggle('active', i === index);
    });
}

// Ouvrir la lightbox
function ouvrirLightboxDetail() {
    const mainImage = document.getElementById('mainImage');
    if (!mainImage) return;
    
    const lightboxImage = document.getElementById('lightboxImage');
    if (lightboxImage) lightboxImage.src = mainImage.src;
    
    if (lightboxModal) lightboxModal.show();
}

// Afficher les métadonnées
function afficherMetaDetail() {
    const meta = document.getElementById('productMeta');
    if (!meta || !produitActuel) return;
    
    const date = new Date(produitActuel.created_at);
    const maintenant = new Date();
    const diffHeures = Math.floor((maintenant - date) / (1000 * 60 * 60));
    
    let tempsAjout;
    if (diffHeures < 1) tempsAjout = "À l'instant";
    else if (diffHeures < 24) tempsAjout = `Il y a ${diffHeures} heure${diffHeures > 1 ? 's' : ''}`;
    else {
        const diffJours = Math.floor(diffHeures / 24);
        tempsAjout = `Il y a ${diffJours} jour${diffJours > 1 ? 's' : ''}`;
    }

    meta.innerHTML = `
        <div class="meta-item">
            <i class="fas fa-tag"></i>
            <span>${produitActuel.categorie || 'Non catégorisé'}</span>
        </div>
        <div class="meta-item">
            <i class="fas fa-clock"></i>
            <span>Ajouté ${tempsAjout}</span>
        </div>
        ${produitActuel.etat ? `
        <div class="meta-item">
            <i class="fas fa-star"></i>
            <span>${produitActuel.etat}</span>
        </div>
        ` : ''}
    `;
}

// Afficher la carte vendeur
function afficherVendeurDetail() {
    const container = document.getElementById('sellerCard');
    if (!container) return;
    
    if (!vendeurActuel) {
        container.innerHTML = '<p class="text-muted">Informations vendeur non disponibles</p>';
        return;
    }

    const initiales = vendeurActuel.nom ? 
        vendeurActuel.nom.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 
        'V';

    const nbVentes = vendeurActuel.nombre_ventes || 0;
    const note = vendeurActuel.note_moyenne || 0;

    container.innerHTML = `
        <div class="seller-header">
            <div class="seller-avatar">${initiales}</div>
            <div class="seller-info">
                <div class="seller-name">${vendeurActuel.nom || 'Vendeur'}</div>
            </div>
        </div>
        <div class="seller-stats">
            <div class="stat">
                <div class="stat-value">${nbVentes}</div>
                <div class="stat-label">Ventes</div>
            </div>
            <div class="stat">
                <div class="stat-value">${vendeurActuel.telephone ? '✓' : '✗'}</div>
                <div class="stat-label">Téléphone</div>
            </div>
            <div class="stat">
                <div class="stat-value">${vendeurActuel.email ? '✓' : '✗'}</div>
                <div class="stat-label">Email</div>
            </div>
        </div>
    `;
}

// Générer des étoiles pour la note
function genererEtoilesDetail(note) {
    const noteNum = parseFloat(note);
    let etoiles = '';
    for (let i = 1; i <= 5; i++) {
        if (i <= Math.floor(noteNum)) {
            etoiles += '<i class="fas fa-star"></i>';
        } else if (i - 0.5 <= noteNum) {
            etoiles += '<i class="fas fa-star-half-alt"></i>';
        } else {
            etoiles += '<i class="far fa-star"></i>';
        }
    }
    return etoiles;
}

// Afficher les boutons d'action
function afficherBoutonsActionDetail() {
    const container = document.getElementById('actionButtons');
    if (!container || !produitActuel || !vendeurActuel) return;
    
    if (!UTILISATEUR_COURANT) {
        container.innerHTML = `
            <a href="connexion.html?redirect=detail&id=${produitActuel.id}" class="btn-acheter">
                <i class="fas fa-sign-in-alt me-2"></i>Connectez-vous pour acheter
            </a>
        `;
        return;
    }

    if (UTILISATEUR_COURANT === vendeurActuel?.id) {
        container.innerHTML = `
            <a href="mes-produits.html" class="btn-acheter">
                <i class="fas fa-box me-2"></i>Voir mes produits
            </a>
        `;
        return;
    }

    container.innerHTML = `
        <button class="btn-acheter" onclick="ouvrirAchatDetail()">
            <i class="fas fa-shopping-cart me-2"></i>Acheter directement
        </button>
    `;
}

// Afficher les détails techniques
function afficherDetailsTechniquesDetail() {
    const container = document.getElementById('detailsTechniques');
    if (!container || !produitActuel) return;
    
    const details = [
        { label: 'Marque', valeur: produitActuel.marque || 'Non spécifiée' },
        { label: 'Modèle', valeur: produitActuel.modele || 'Non spécifié' },
        { label: 'Couleur', valeur: produitActuel.couleur || 'Non spécifiée' },
        { label: 'État', valeur: produitActuel.etat || 'Non spécifié' },
        { label: 'Référence', valeur: produitActuel.id.substring(0, 8) + '...' },
    ];

    container.innerHTML = `
        <h3 class="details-title">
            <i class="fas fa-info-circle me-2"></i>Détails du produit
        </h3>
        ${details.map(d => `
            <div class="detail-row">
                <div class="detail-label">${d.label}</div>
                <div class="detail-value">${d.valeur}</div>
            </div>
        `).join('')}
    `;
}

// Charger les produits similaires
async function chargerProduitsSimilairesDetail() {
    if (!supabase1 || !produitActuel) return;
    
    try {
        const { data, error } = await supabase1
            .from('produits')
            .select('*')
            .eq('categorie', produitActuel.categorie)
            .neq('id', produitActuel.id)
            .eq('est_actif', true)
            .limit(4);

        if (error) throw error;

        const container = document.getElementById('similarProducts');
        if (!container) return;

        if (!data || data.length === 0) {
            container.classList.add('d-none');
            return;
        }

        container.classList.remove('d-none');
        
        container.innerHTML = `
            <h3 class="similar-title">
                <i class="fas fa-tags me-2"></i>Produits similaires
            </h3>
            <div class="similar-grid">
                ${data.map(p => `
                    <div class="similar-card" onclick="window.location.href='detail-annonce.html?id=${p.id}'">
                        <img src="${p.image_url || 'image/default-product.jpg'}" 
                             alt="${p.titre}" 
                             class="similar-image"
                             onerror="this.src='image/default-product.jpg'">
                        <div class="similar-info">
                            <div class="similar-name">${p.titre || 'Sans titre'}</div>
                            <div class="similar-price">${formatPrixDetail(p.prix)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

    } catch (error) {
        console.error('Erreur chargement produits similaires:', error);
        const container = document.getElementById('similarProducts');
        if (container) container.classList.add('d-none');
    }
}

/*// Initialiser la carte de livraison
function initialiserCarteLivraison() {
    const dakarCenter = [14.7167, -17.4677];
    
    if (map) {
        map.remove();
    }
    
    map = L.map('map').setView(dakarCenter, 12);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    const dakarBounds = L.latLngBounds(
        L.latLng(14.6, -17.6),
        L.latLng(14.8, -17.3)
    );
    map.setMaxBounds(dakarBounds);
    map.on('drag', function() {
        map.panInsideBounds(dakarBounds, { animate: false });
    });
    
    marker = L.marker(dakarCenter, { draggable: true }).addTo(map);
    marker.bindPopup('Déplacez-moi pour choisir votre position').openPopup();
    
    marker.on('dragend', function(e) {
        const pos = e.target.getLatLng();
        positionLivraison = [pos.lat, pos.lng];
        mettreAJourFraisLivraison();
    });
    
    map.on('click', function(e) {
        marker.setLatLng(e.latlng);
        positionLivraison = [e.latlng.lat, e.latlng.lng];
        mettreAJourFraisLivraison();
    });
    
    positionLivraison = dakarCenter;
    mettreAJourFraisLivraison();
}*/


/*// Initialiser la carte de livraison
function initialiserCarteLivraison() {
    const dakarCenter = [14.7167, -17.4677];
    
    if (map) {
        map.remove();
    }
    
    map = L.map('map').setView(dakarCenter, 12);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    const dakarBounds = L.latLngBounds(
        L.latLng(14.6, -17.6),
        L.latLng(14.8, -17.3)
    );
    map.setMaxBounds(dakarBounds);
    map.on('drag', function() {
        map.panInsideBounds(dakarBounds, { animate: false });
    });
    
    marker = L.marker(dakarCenter, { draggable: true }).addTo(map);
    marker.bindPopup('Déplacez-moi pour choisir votre position').openPopup();
    
    marker.on('dragend', function(e) {
        const pos = e.target.getLatLng();
        positionLivraison = [pos.lat, pos.lng];
        // 🔥 NE PAS rappeler mettreAJourFraisLivraison() ici
        // mettreAJourFraisLivraison(); ← À SUPPRIMER OU COMMENTER
    });
    
    map.on('click', function(e) {
        marker.setLatLng(e.latlng);
        positionLivraison = [e.latlng.lat, e.latlng.lng];
        // 🔥 NE PAS rappeler mettreAJourFraisLivraison() ici
        // mettreAJourFraisLivraison(); ← À SUPPRIMER OU COMMENTER
    });
    
    positionLivraison = dakarCenter;
    // 🔥 NE PAS rappeler mettreAJourFraisLivraison() ici
    // mettreAJourFraisLivraison(); ← À SUPPRIMER OU COMMENTER
}*/

// Initialiser la carte de livraison avec géolocalisation
function initialiserCarteLivraison() {
    // Centre par défaut (Dakar)
    const dakarCenter = [14.7167, -17.4677];
    
    if (map) {
        map.remove();
    }
    
    // Créer la carte avec une vue temporaire
    map = L.map('map').setView(dakarCenter, 12);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    const dakarBounds = L.latLngBounds(
        L.latLng(14.6, -17.6),
        L.latLng(14.8, -17.3)
    );
    map.setMaxBounds(dakarBounds);
    map.on('drag', function() {
        map.panInsideBounds(dakarBounds, { animate: false });
    });
    
    // 🔥 Essayer d'obtenir la position exacte de l'utilisateur
    if (navigator.geolocation) {
        console.log('📍 Tentative de géolocalisation...');
        
        // Afficher un indicateur de chargement
        const mapContainer = document.getElementById('map');
        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'text-center p-3';
        loadingMsg.id = 'geoloc-loading';
        loadingMsg.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Recherche de votre position...';
        mapContainer.parentNode.insertBefore(loadingMsg, mapContainer);
        
        navigator.geolocation.getCurrentPosition(
            // Succès - position trouvée
            function(position) {
                console.log('✅ Position trouvée:', position.coords);
                
                // Supprimer le message de chargement
                const loadingEl = document.getElementById('geoloc-loading');
                if (loadingEl) loadingEl.remove();
                
                const userPos = [position.coords.latitude, position.coords.longitude];
                
                // Vérifier si la position est dans les limites de Dakar
                if (dakarBounds.contains(L.latLng(userPos[0], userPos[1]))) {
                    // Centrer la carte sur la position de l'utilisateur
                    map.setView(userPos, 14);
                    
                    // Créer le marqueur à la position de l'utilisateur
                    marker = L.marker(userPos, { draggable: true }).addTo(map);
                    positionLivraison = userPos;
                    
                    marker.bindPopup('📌 Votre position actuelle<br>Déplacez-moi pour ajuster').openPopup();
                } else {
                    console.log('⚠️ Position hors zone, utilisation du centre de Dakar');
                    // Utiliser le centre de Dakar
                    marker = L.marker(dakarCenter, { draggable: true }).addTo(map);
                    positionLivraison = dakarCenter;
                    marker.bindPopup('Déplacez-moi pour choisir votre position').openPopup();
                }
                
                // Ajouter les événements de déplacement
                ajouterEvenementsMarqueur();
            },
            // Erreur - impossible d'obtenir la position
            function(error) {
                console.warn('⚠️ Erreur de géolocalisation:', error.message);
                
                // Supprimer le message de chargement
                const loadingEl = document.getElementById('geoloc-loading');
                if (loadingEl) loadingEl.remove();
                
                // Utiliser le centre de Dakar par défaut
                marker = L.marker(dakarCenter, { draggable: true }).addTo(map);
                positionLivraison = dakarCenter;
                marker.bindPopup('Déplacez-moi pour choisir votre position').openPopup();
                
                // Afficher un message selon le type d'erreur
                let message = "Position par défaut (Dakar)";
                if (error.code === 1) {
                    message = "🌍 Position non partagée - Utilisation du centre de Dakar";
                } else if (error.code === 2) {
                    message = "📡 Position non disponible - Utilisation du centre de Dakar";
                } else if (error.code === 3) {
                    message = "⏱️ Délai dépassé - Utilisation du centre de Dakar";
                }
                
                const infoMsg = document.createElement('div');
                infoMsg.className = 'alert alert-warning mt-2 p-2 small';
                infoMsg.innerHTML = `<i class="fas fa-info-circle me-1"></i>${message}`;
                document.getElementById('map').parentNode.appendChild(infoMsg);
                
                // Supprimer le message après 5 secondes
                setTimeout(() => {
                    if (infoMsg.parentNode) infoMsg.remove();
                }, 5000);
                
                ajouterEvenementsMarqueur();
            },
            // Options de géolocalisation
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    } else {
        // Navigateur ne supporte pas la géolocalisation
        console.log('⚠️ Géolocalisation non supportée');
        
        marker = L.marker(dakarCenter, { draggable: true }).addTo(map);
        positionLivraison = dakarCenter;
        marker.bindPopup('Déplacez-moi pour choisir votre position').openPopup();
        
        const infoMsg = document.createElement('div');
        infoMsg.className = 'alert alert-warning mt-2 p-2 small';
        infoMsg.innerHTML = '<i class="fas fa-info-circle me-1"></i>Géolocalisation non supportée - Position par défaut (Dakar)';
        document.getElementById('map').parentNode.appendChild(infoMsg);
        
        setTimeout(() => {
            if (infoMsg.parentNode) infoMsg.remove();
        }, 5000);
        
        ajouterEvenementsMarqueur();
    }
}

// 🔥 Fonction pour ajouter les événements du marqueur
function ajouterEvenementsMarqueur() {
    if (!marker) return;
    
    marker.on('dragend', function(e) {
        const pos = e.target.getLatLng();
        positionLivraison = [pos.lat, pos.lng];
        console.log('📌 Nouvelle position:', positionLivraison);
    });
    
    map.on('click', function(e) {
        marker.setLatLng(e.latlng);
        positionLivraison = [e.latlng.lat, e.latlng.lng];
        console.log('📌 Nouvelle position (clic):', positionLivraison);
    });
}

// Mettre à jour l'affichage des frais
function mettreAJourFraisLivraison() {
    const frais = calculerFrais(produitActuel.prix);
    
    const fraisAcheteurEl = document.getElementById('fraisAcheteur');
    const fraisLivraisonEl = document.getElementById('fraisLivraison');
    const totalEl = document.getElementById('totalAvecFrais');
    
    if (fraisAcheteurEl) fraisAcheteurEl.textContent = frais.fraisAcheteur.toLocaleString() + ' FCFA';
    if (fraisLivraisonEl) fraisLivraisonEl.textContent = frais.livraison.toLocaleString() + ' FCFA';
    if (totalEl) totalEl.textContent = frais.total.toLocaleString() + ' FCFA';
}

// ============================================
// PAGE DÉTAIL ANNONCE - PARTIE MODIFIÉE
// ============================================

/*// 🔥 Ouvrir le modal d'achat avec prise en compte des commandes gratuites
async function ouvrirAchatDetail() {
    if (!UTILISATEUR_COURANT) {
        window.location.href = `connexion.html?redirect=detail&id=${produitActuel.id}`;
        return;
    }

    if (UTILISATEUR_COURANT === vendeurActuel?.id) {
        alert("Vous ne pouvez pas acheter votre propre produit");
        return;
    }

    const achatProductTitle = document.getElementById('achatProductTitle');
    if (achatProductTitle) achatProductTitle.textContent = produitActuel.titre;
    
    const achatProductPrice = document.getElementById('achatProductPrice');
    if (achatProductPrice) achatProductPrice.innerHTML = formatPrixDetail(produitActuel.prix);
    
    // 🔥 Vérifier les commandes gratuites
    const commandesGratuites = await verifierCommandesGratuites();
    
    // 🔥 Supprimer l'ancien message s'il existe
    const oldInfo = document.getElementById('fraisInfo');
    if (oldInfo) oldInfo.remove();
    
    // 🔥 Ajouter un message d'information
    const fraisInfo = document.createElement('div');
    fraisInfo.id = 'fraisInfo';
    
    if (commandesGratuites > 0) {
        fraisInfo.className = 'alert alert-success mb-3';
        fraisInfo.innerHTML = `
            <i class="fas fa-gift me-2"></i>
            <strong>🎉 Félicitations !</strong> Cette commande est <strong>GRATUITE</strong> (frais offerts).<br>
            <small>Il vous reste ${commandesGratuites} commande(s) gratuite(s).</small>
        `;
    } else {
        fraisInfo.className = 'alert alert-info mb-3';
        fraisInfo.innerHTML = `
            <i class="fas fa-info-circle me-2"></i>
            Les frais de protection et de livraison s'appliquent à cette commande.
        `;
    }
    
    const modalBody = document.querySelector('#achatModal .modal-body');
    if (modalBody) {
        modalBody.insertBefore(fraisInfo, modalBody.firstChild);
    }
    
    // 🔥 Calculer les frais avec la nouvelle fonction
    const frais = await calculerFraisAvecGratuit(produitActuel.prix);
    
    document.getElementById('prixArticle').textContent = formatPrixDetail(produitActuel.prix);
    document.getElementById('fraisAcheteur').textContent = frais.gratuit ? '0 FCFA' : frais.fraisAcheteur.toLocaleString() + ' FCFA';
    document.getElementById('fraisLivraison').textContent = frais.gratuit ? '0 FCFA' : frais.livraison.toLocaleString() + ' FCFA';
    document.getElementById('totalAvecFrais').textContent = frais.total.toLocaleString() + ' FCFA';
    
    // 🔥 Ajouter un badge pour les commandes gratuites
    const oldBadge = document.getElementById('gratuitBadge');
    if (oldBadge) oldBadge.remove();
    
    if (frais.gratuit) {
        const totalElement = document.getElementById('totalAvecFrais').parentNode;
        const gratuitBadge = document.createElement('div');
        gratuitBadge.id = 'gratuitBadge';
        gratuitBadge.className = 'badge bg-success mt-2 p-2';
        gratuitBadge.innerHTML = '<i class="fas fa-check-circle me-1"></i>Commande gratuite (frais offerts)';
        totalElement.appendChild(gratuitBadge);
    }
    
    setTimeout(() => {
        initialiserCarteLivraison();
    }, 500);
    
    if (achatModal) achatModal.show();
}*/


// 🔥 Ouvrir le modal d'achat avec prise en compte des commandes gratuites
/*async function ouvrirAchatDetail() {
    if (!UTILISATEUR_COURANT) {
        window.location.href = `connexion.html?redirect=detail&id=${produitActuel.id}`;
        return;
    }

    if (UTILISATEUR_COURANT === vendeurActuel?.id) {
        alert("Vous ne pouvez pas acheter votre propre produit");
        return;
    }

    const achatProductTitle = document.getElementById('achatProductTitle');
    if (achatProductTitle) achatProductTitle.textContent = produitActuel.titre;
    
    const achatProductPrice = document.getElementById('achatProductPrice');
    if (achatProductPrice) achatProductPrice.innerHTML = formatPrixDetail(produitActuel.prix);
    
    // 🔥 Vérifier les commandes gratuites
    const commandesGratuites = await verifierCommandesGratuites();
    console.log('🎁 Commandes gratuites restantes:', commandesGratuites); // Debug
    
    // 🔥 Supprimer l'ancien message s'il existe
    const oldInfo = document.getElementById('fraisInfo');
    if (oldInfo) oldInfo.remove();
    
    // 🔥 Supprimer l'ancien badge s'il existe
    const oldBadge = document.getElementById('gratuitBadge');
    if (oldBadge) oldBadge.remove();
    
    // 🔥 Calculer les frais avec la nouvelle fonction
    const frais = await calculerFraisAvecGratuit(produitActuel.prix);
    console.log('💰 Frais calculés:', frais); // Debug
    
    // 🔥 Mettre à jour l'affichage des frais
    document.getElementById('prixArticle').textContent = formatPrixDetail(produitActuel.prix);
    document.getElementById('fraisAcheteur').textContent = frais.gratuit ? '0 FCFA' : frais.fraisAcheteur.toLocaleString() + ' FCFA';
    document.getElementById('fraisLivraison').textContent = frais.gratuit ? '0 FCFA' : frais.livraison.toLocaleString() + ' FCFA';
    document.getElementById('totalAvecFrais').textContent = frais.total.toLocaleString() + ' FCFA';
    
    // 🔥 Ajouter un message d'information
    const modalBody = document.querySelector('#achatModal .modal-body');
    if (modalBody) {
        const fraisInfo = document.createElement('div');
        fraisInfo.id = 'fraisInfo';
        
        if (frais.gratuit) {
            fraisInfo.className = 'alert alert-success mb-3';
            fraisInfo.innerHTML = `
                <i class="fas fa-gift me-2"></i>
                <strong>🎉 Félicitations !</strong> Cette commande est <strong>GRATUITE</strong> (frais offerts).<br>
                <small>Il vous reste ${commandesGratuites} commande(s) gratuite(s).</small>
            `;
            
            // 🔥 Ajouter un badge pour les commandes gratuites
            const totalElement = document.getElementById('totalAvecFrais').parentNode;
            const gratuitBadge = document.createElement('div');
            gratuitBadge.id = 'gratuitBadge';
            gratuitBadge.className = 'badge bg-success mt-2 p-2';
            gratuitBadge.innerHTML = '<i class="fas fa-check-circle me-1"></i>Commande gratuite (frais offerts)';
            totalElement.appendChild(gratuitBadge);
        } else {
            fraisInfo.className = 'alert alert-info mb-3';
            fraisInfo.innerHTML = `
                <i class="fas fa-info-circle me-2"></i>
                Les frais de protection et de livraison s'appliquent à cette commande.
            `;
        }
        
        modalBody.insertBefore(fraisInfo, modalBody.firstChild);
    }
    
    setTimeout(() => {
        initialiserCarteLivraison();
    }, 500);
    
    if (achatModal) achatModal.show();
}*/



// 🔥 Ouvrir le modal d'achat avec prise en compte des commandes gratuites
async function ouvrirAchatDetail() {
    if (!UTILISATEUR_COURANT) {
        window.location.href = `connexion.html?redirect=detail&id=${produitActuel.id}`;
        return;
    }

    if (UTILISATEUR_COURANT === vendeurActuel?.id) {
        alert("Vous ne pouvez pas acheter votre propre produit");
        return;
    }

    const achatProductTitle = document.getElementById('achatProductTitle');
    if (achatProductTitle) achatProductTitle.textContent = produitActuel.titre;
    
    const achatProductPrice = document.getElementById('achatProductPrice');
    if (achatProductPrice) achatProductPrice.innerHTML = formatPrixDetail(produitActuel.prix);
    
    // 🔥 Vérifier les commandes gratuites
    const commandesGratuites = await verifierCommandesGratuites();
    console.log('🎁 Commandes gratuites restantes:', commandesGratuites); // Debug
    
    // 🔥 Calculer les frais avec la nouvelle fonction
    const frais = await calculerFraisAvecGratuit(produitActuel.prix);
    console.log('💰 Frais calculés:', frais); // Debug
    
    // 🔥 Mettre à jour l'affichage des frais
    document.getElementById('prixArticle').textContent = formatPrixDetail(produitActuel.prix);
    document.getElementById('fraisAcheteur').textContent = frais.gratuit ? '0 FCFA' : frais.fraisAcheteur.toLocaleString() + ' FCFA';
    document.getElementById('fraisLivraison').textContent = frais.gratuit ? '0 FCFA' : frais.livraison.toLocaleString() + ' FCFA';
    document.getElementById('totalAvecFrais').textContent = frais.total.toLocaleString() + ' FCFA';
    
    // 🔥 Vider les conteneurs
    const fraisInfoContainer = document.getElementById('fraisInfoContainer');
    const gratuitBadgeContainer = document.getElementById('gratuitBadgeContainer');
    
    if (fraisInfoContainer) fraisInfoContainer.innerHTML = '';
    if (gratuitBadgeContainer) gratuitBadgeContainer.innerHTML = '';
    
    // 🔥 Ajouter un message d'information dans le conteneur prévu
    if (fraisInfoContainer) {
        const fraisInfo = document.createElement('div');
        fraisInfo.id = 'fraisInfo';
        
        if (frais.gratuit) {
            fraisInfo.className = 'alert alert-success mb-3';
            fraisInfo.innerHTML = `
                <i class="fas fa-gift me-2"></i>
                <strong>🎉 Félicitations !</strong> frais + livraison offerts.<br>
                <small>Il vous reste ${commandesGratuites} commande(s) sans frais.</small>
            `;
        } else {
            fraisInfo.className = 'alert alert-info mb-3';
            fraisInfo.innerHTML = `
                <i class="fas fa-info-circle me-2"></i>
                Les frais de protection et de livraison s'appliquent à cette commande.
            `;
        }
        
        fraisInfoContainer.appendChild(fraisInfo);
    }
    
    // 🔥 Ajouter un badge pour les commandes gratuites dans le conteneur prévu
    if (frais.gratuit && gratuitBadgeContainer) {
        const gratuitBadge = document.createElement('div');
        gratuitBadge.id = 'gratuitBadge';
        gratuitBadge.className = 'badge bg-success mt-2 p-2';
        gratuitBadge.innerHTML = '<i class="fas fa-check-circle me-1"></i>frais + livraison offerts';
        gratuitBadgeContainer.appendChild(gratuitBadge);
    }
    
    setTimeout(() => {
        initialiserCarteLivraison();
    }, 500);
    
    if (achatModal) achatModal.show();
}






/*// 🔥 Confirmer l'achat (sans décrémentation manuelle)
async function confirmerAchatDetail() {
    if (!supabase1 || !UTILISATEUR_COURANT || !produitActuel || !vendeurActuel) return;
    
    if (!positionLivraison) {
        alert('Veuillez sélectionner une position de livraison sur la carte');
        return;
    }
    
    try {
        const { data: produit, error: checkError } = await supabase1
            .from('produits')
            .select('est_actif')
            .eq('id', produitActuel.id)
            .single();
            
        if (checkError) throw checkError;
        
        if (!produit.est_actif) {
            alert('Ce produit n\'est plus disponible à la vente');
            window.location.reload();
            return;
        }
        
        // 🔥 Vérifier les commandes gratuites pour le prix
        const commandesGratuites = await verifierCommandesGratuites();
        const frais = commandesGratuites > 0 
            ? { total: produitActuel.prix }
            : await calculerFraisAvecGratuit(produitActuel.prix);
        
        const codeUnique = genererCodeUniqueDetail();
        
        const commande = {
            code_unique: codeUnique,
            id_produit: produitActuel.id,
            id_acheteur: UTILISATEUR_COURANT,
            id_vendeur: vendeurActuel.id,
            prix: frais.total,
            latitude: positionLivraison[0],
            longitude: positionLivraison[1],
            telephone_client: userData?.telephone || '',
            etat: 'en attente de livraison',
            paiement_recu: false,
            created_at: new Date().toISOString()
        };

        const { error } = await supabase1
            .from('commandes')
            .insert([commande]);

        if (error) throw error;

        // 🔥 NE PAS décrémenter ici - le trigger SQL le fera automatiquement

        if (achatModal) achatModal.hide();
        
        const messageGratuit = commandesGratuites > 0 
            ? `🎉 Commande gratuite enregistrée !`
            : '✅ Achat confirmé ! Votre commande a été enregistrée.';
        
        afficherMessageDetail(messageGratuit, 'success');
        
        setTimeout(() => {
            window.location.href = `historique_commande.html?success=${codeUnique}`;
        }, 2000);

    } catch (error) {
        console.error('Erreur achat:', error);
        afficherMessageDetail('❌ Erreur lors de l\'achat: ' + error.message, 'error');
    }
}*/



// 🔥 Confirmer l'achat (sans décrémentation manuelle)
async function confirmerAchatDetail() {
    if (!supabase1 || !UTILISATEUR_COURANT || !produitActuel || !vendeurActuel) return;
    
    if (!positionLivraison) {
        alert('Veuillez sélectionner une position de livraison sur la carte');
        return;
    }
    
    try {
        const { data: produit, error: checkError } = await supabase1
            .from('produits')
            .select('est_actif')
            .eq('id', produitActuel.id)
            .single();
            
        if (checkError) throw checkError;
        
        if (!produit.est_actif) {
            alert('Ce produit n\'est plus disponible à la vente');
            window.location.reload();
            return;
        }
        
        // 🔥 Vérifier les commandes gratuites pour le prix
        const commandesGratuites = await verifierCommandesGratuites();
        const frais = commandesGratuites > 0 
            ? { total: produitActuel.prix }
            : await calculerFraisAvecGratuit(produitActuel.prix);
        
        const codeUnique = genererCodeUniqueDetail();
        
        const commande = {
            code_unique: codeUnique,
            id_produit: produitActuel.id,
            id_acheteur: UTILISATEUR_COURANT,
            id_vendeur: vendeurActuel.id,
            prix: frais.total,
            latitude: positionLivraison[0],
            longitude: positionLivraison[1],
            telephone_client: userData?.telephone || '',
            etat: 'en attente de livraison',
            paiement_recu: false,
            created_at: new Date().toISOString()
        };

        const { error, data: commandeInseree } = await supabase1
            .from('commandes')
            .insert([commande])
            .select()
            .single();

        if (error) throw error;

        // 🔥 ENVOYER LA NOTIFICATION AU VENDEUR
        await envoyerNotificationCommande(commandeInseree, vendeurActuel, produitActuel);

        // 🔥 NE PAS décrémenter ici - le trigger SQL le fera automatiquement

        if (achatModal) achatModal.hide();
        
        const messageGratuit = commandesGratuites > 0 
            ? `🎉 Commande gratuite enregistrée !`
            : '✅ Achat confirmé ! Votre commande a été enregistrée.';
        
        afficherMessageDetail(messageGratuit, 'success');
        
        setTimeout(() => {
            window.location.href = `historique_commande.html?success=${codeUnique}`;
        }, 2000);

    } catch (error) {
        console.error('Erreur achat:', error);
        afficherMessageDetail('❌ Erreur lors de l\'achat: ' + error.message, 'error');
    }
}


// Afficher une erreur
function afficherErreurDetail() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorState = document.getElementById('errorState');
    
    if (loadingIndicator) loadingIndicator.classList.add('d-none');
    if (errorState) errorState.classList.remove('d-none');
}

// Afficher un message
function afficherMessageDetail(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show position-fixed`;
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '1050';
    alertDiv.style.minWidth = '300px';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) alertDiv.remove();
    }, 5000);
}

// Formater le prix
function formatPrixDetail(prix) {
    if (!prix) return 'Prix non disponible';
    return prix.toLocaleString('fr-FR') + ' FCFA';
}

// Générer un code unique
function genererCodeUniqueDetail() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'CMD-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += '-' + Date.now().toString().slice(-4);
    return code;
}





// ============================================
// 🔥 FONCTIONS DE NOTIFICATIONS CORRIGÉES
// ============================================

// Envoyer une notification au vendeur après une commande
async function envoyerNotificationCommande(commande, vendeur, produit) {
    if (!supabase1) return;
    
    try {
        // Récupérer les tokens FCM du vendeur
        const { data: tokens, error: tokensError } = await supabase1
            .from('fcm_tokens')
            .select('token')
            .eq('user_id', commande.id_vendeur);

        if (tokensError) {
            console.error('❌ Erreur récupération tokens:', tokensError);
            return;
        }

        if (!tokens || tokens.length === 0) {
            console.log('ℹ️ Aucun token FCM trouvé pour le vendeur');
            return;
        }

        // Récupérer le nom de l'acheteur depuis la commande ou userData
        const acheteurNom = commande.acheteur_nom || userData?.nom || 'Un acheteur';
        const produitTitre = produit.titre || 'un produit';
        const prixFormate = commande.prix?.toLocaleString() + ' FCFA' || '';

        // Préparer le message de notification
        const notification = {
            title: '🛍️ Nouvelle commande reçue !',
            body: `${acheteurNom} a commandé "${produitTitre}" pour ${prixFormate}`,
            icon: '/icon-192.png',
            badge: '/badge-72.png',
            data: {
                commande_id: commande.id,
                type: 'nouvelle_commande',
                url: '/historique-ventes.html',
                click_action: '/historique-ventes.html'
            },
            actions: [
                { action: 'open', title: 'Voir la commande' },
                { action: 'close', title: 'Fermer' }
            ]
        };

        // ❌ Ne pas envoyer depuis le frontend !
        // La notification doit être envoyée depuis l'Edge Function
        
        // ✅ Solution 1: Appeler l'Edge Function
        const { error: functionError } = await supabase1.functions.invoke('notify-commande', {
            body: {
                commande: commande,
                vendeur: vendeur,
                produit: produit,
                acheteur_nom: acheteurNom,
                tokens: tokens.map(t => t.token)
            }
        });

        if (functionError) {
            console.error('❌ Erreur appel Edge Function:', functionError);
        } else {
            console.log(`📨 Notifications envoyées via Edge Function`);
        }

    } catch (error) {
        console.error('❌ Erreur envoi notification:', error);
    }
}














/*// ============================================
// PAGE VENDRE - PUBLIER UN PRODUIT
// ============================================

let vendreLoading = false;
let imagesSelectionnees = [];
let limiteProduits = 5;

// Initialiser la page vendre
function initialiserPageVendre() {
    console.log('💰 Initialisation page vendre...');
    
    verifierConnexionVendeur();
    initialiserUploadImages();
    verifierLimiteProduits();
    
    const form = document.getElementById('vendreForm');
    if (form) {
        form.addEventListener('submit', publierProduit);
    }
}

// Vérifier que l'utilisateur est connecté et a le rôle vendeur
async function verifierConnexionVendeur() {
    // Attendre que l'auth soit initialisée
    await attendreUtilisateur();
    
    const estConnecte = await verifierConnexion();
    
    if (!estConnecte) {
        window.location.href = 'connexion.html?redirect=vendre';
        return;
    }
    
    // Vérifier le rôle vendeur
    if (!userRoles || !userRoles.includes('vendeur')) {
        alert("Vous devez avoir un compte vendeur pour accéder à cette page.");
        window.location.href = 'index.html';
    }
}

// Initialiser l'upload d'images
function initialiserUploadImages() {
    const addImageBtn = document.getElementById('addImageBtn');
    const imageInput = document.getElementById('imageInput');
    
    if (addImageBtn && imageInput) {
        addImageBtn.addEventListener('click', () => {
            imageInput.click();
        });
        
        imageInput.addEventListener('change', (e) => {
            const fichiers = Array.from(e.target.files);
            if (fichiers.length + imagesSelectionnees.length > 5) {
                alert('Vous ne pouvez pas ajouter plus de 5 images au total.');
                return;
            }
            
            fichiers.forEach(fichier => {
                if (fichier.size > 5 * 1024 * 1024) {
                    alert(`L'image ${fichier.name} dépasse 5 Mo et ne sera pas ajoutée.`);
                    return;
                }
                
                const reader = new FileReader();
                reader.onload = (event) => {
                    imagesSelectionnees.push({
                        file: fichier,
                        preview: event.target.result
                    });
                    afficherPrevisualisations();
                };
                reader.readAsDataURL(fichier);
            });
        });
    }
}

// Afficher les prévisualisations d'images
function afficherPrevisualisations() {
    const container = document.getElementById('imagePreviewContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    imagesSelectionnees.forEach((img, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'image-preview-wrapper';
        
        wrapper.innerHTML = `
            <img src="${img.preview}" class="image-preview">
            <div class="remove-image" onclick="supprimerImage(${index})">
                <i class="fas fa-times"></i>
            </div>
        `;
        
        container.appendChild(wrapper);
    });
}

// Supprimer une image
function supprimerImage(index) {
    imagesSelectionnees.splice(index, 1);
    afficherPrevisualisations();
}

// Vérifier la limite de produits
async function verifierLimiteProduits() {
    // Attendre que l'utilisateur soit chargé
    await attendreUtilisateur();
    
    if (!UTILISATEUR_COURANT || !supabase1) return;
    
    try {
        const { count, error } = await supabase1
            .from('produits')
            .select('*', { count: 'exact', head: true })
            .eq('vendeur_id', UTILISATEUR_COURANT);
            
        if (error) throw error;
        
        const countProduits = count || 0;
        const limitInfo = document.getElementById('productCount');
        const limitMessage = document.getElementById('productCountMessage');
        const submitBtn = document.getElementById('submitBtn');
        
        if (limitInfo) {
            limitInfo.textContent = `${countProduits}/${limiteProduits}`;
        }
        
        if (limitMessage) {
            limitMessage.textContent = `Vous avez ${countProduits} produit(s) sur ${limiteProduits} maximum`;
        }
        
        if (submitBtn && countProduits >= limiteProduits) {
            submitBtn.disabled = true;
            submitBtn.title = "Limite de produits atteinte (5 maximum)";
        }
        
    } catch (error) {
        console.error('Erreur vérification limite:', error);
    }
}

// Publier un produit avec upload d'images compressées
async function publierProduit(e) {
    e.preventDefault();
    
    if (vendreLoading) return;
    
    // Récupérer les valeurs
    const titre = document.getElementById('titre')?.value.trim();
    const categorie = document.getElementById('categorie')?.value;
    const prix = parseFloat(document.getElementById('prix')?.value);
    const etat = document.getElementById('etat')?.value;
    const marque = document.getElementById('marque')?.value.trim();
    const modele = document.getElementById('modele')?.value.trim();
    const couleur = document.getElementById('couleur')?.value.trim();
    const description = document.getElementById('description')?.value.trim();
    
    // Validations
    if (!titre || !categorie || !prix || !etat || !description) {
        alert('Veuillez remplir tous les champs obligatoires.');
        return;
    }
    
    if (prix < 100) {
        alert('Le prix minimum est de 100 FCFA.');
        return;
    }
    
    if (imagesSelectionnees.length === 0) {
        alert('Veuillez ajouter au moins une photo.');
        return;
    }
    
    setVendreLoading(true);
    
    try {
        // Uploader les images vers Supabase Storage
        console.log('📤 Upload des images vers le bucket "photos"...');
        const imageUrls = await uploaderPlusieursImages(imagesSelectionnees);
        
        if (imageUrls.length === 0) {
            throw new Error('Aucune image n\'a pu être uploadée');
        }
        
        console.log(`✅ ${imageUrls.length} images uploadées avec succès`);
        
        // Créer le produit
        const nouveauProduit = {
            titre,
            categorie,
            prix,
            etat,
            marque: marque || null,
            modele: modele || null,
            couleur: couleur || null,
            description,
            image_url: imageUrls[0] || null,
            images: imageUrls,
            vendeur_id: UTILISATEUR_COURANT,
            est_actif: true,
            created_at: new Date().toISOString()
        };
        
        const { error } = await supabase1
            .from('produits')
            .insert([nouveauProduit]);
            
        if (error) throw error;
        
        alert('✅ Produit publié avec succès !');
        window.location.href = 'mes-produits.html';
        
    } catch (error) {
        console.error('❌ Erreur publication:', error);
        alert('❌ Erreur lors de la publication: ' + error.message);
    } finally {
        setVendreLoading(false);
    }
}

// Gérer l'état de chargement
function setVendreLoading(loading) {
    vendreLoading = loading;
    const btn = document.getElementById('submitBtn');
    const btnText = document.getElementById('submitText');
    const btnSpinner = document.getElementById('submitSpinner');
    
    if (btn && btnText && btnSpinner) {
        btn.disabled = loading;
        if (loading) {
            btnText.classList.add('d-none');
            btnSpinner.classList.remove('d-none');
        } else {
            btnText.classList.remove('d-none');
            btnSpinner.classList.add('d-none');
        }
    }
}*/



// ============================================
// PAGE VENDRE - PUBLIER UN PRODUIT AVEC LOCALISATION
// ============================================

let vendreLoading = false;
let imagesSelectionnees = [];
let limiteProduits = 5;

// 🔥 Variables pour la carte
let mapVendre = null;
let markerVendre = null;
let positionVendre = null;

// Initialiser la page vendre
function initialiserPageVendre() {
    console.log('💰 Initialisation page vendre...');
    
    verifierConnexionVendeur();
    initialiserUploadImages();
    verifierLimiteProduits();
    
    // 🔥 Initialiser la carte après un petit délai pour que le DOM soit prêt
    setTimeout(() => {
        initialiserCarteVendre();
    }, 500);
    
    const form = document.getElementById('vendreForm');
    if (form) {
        form.addEventListener('submit', publierProduit);
    }

}

// Vérifier que l'utilisateur est connecté et a le rôle vendeur
async function verifierConnexionVendeur() {
    // Attendre que l'auth soit initialisée
    await attendreUtilisateur();
    
    const estConnecte = await verifierConnexion();
    
    if (!estConnecte) {
        window.location.href = 'connexion.html?redirect=vendre';
        return;
    }
    
    // Vérifier le rôle vendeur
    if (!userRoles || !userRoles.includes('vendeur')) {
        alert("Vous devez avoir un compte vendeur pour accéder à cette page.");
        window.location.href = 'index.html';
    }


    initialiserCompteurVentes();     // ✅ À GARDER

}

// Initialiser l'upload d'images
function initialiserUploadImages() {
    const addImageBtn = document.getElementById('addImageBtn');
    const imageInput = document.getElementById('imageInput');
    
    if (addImageBtn && imageInput) {
        addImageBtn.addEventListener('click', () => {
            imageInput.click();
        });
        
        imageInput.addEventListener('change', (e) => {
            const fichiers = Array.from(e.target.files);
            if (fichiers.length + imagesSelectionnees.length > 5) {
                alert('Vous ne pouvez pas ajouter plus de 5 images au total.');
                return;
            }
            
            fichiers.forEach(fichier => {
                if (fichier.size > 5 * 1024 * 1024) {
                    alert(`L'image ${fichier.name} dépasse 5 Mo et ne sera pas ajoutée.`);
                    return;
                }
                
                const reader = new FileReader();
                reader.onload = (event) => {
                    imagesSelectionnees.push({
                        file: fichier,
                        preview: event.target.result
                    });
                    afficherPrevisualisations();
                };
                reader.readAsDataURL(fichier);
            });
        });
    }
}

// Afficher les prévisualisations d'images
function afficherPrevisualisations() {
    const container = document.getElementById('imagePreviewContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    imagesSelectionnees.forEach((img, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'image-preview-wrapper';
        
        wrapper.innerHTML = `
            <img src="${img.preview}" class="image-preview">
            <div class="remove-image" onclick="supprimerImage(${index})">
                <i class="fas fa-times"></i>
            </div>
        `;
        
        container.appendChild(wrapper);
    });
}

// Supprimer une image
function supprimerImage(index) {
    imagesSelectionnees.splice(index, 1);
    afficherPrevisualisations();
}

// Vérifier la limite de produits
async function verifierLimiteProduits() {
    // Attendre que l'utilisateur soit chargé
    await attendreUtilisateur();
    
    if (!UTILISATEUR_COURANT || !supabase1) return;
    
    try {
        const { count, error } = await supabase1
            .from('produits')
            .select('*', { count: 'exact', head: true })
            .eq('vendeur_id', UTILISATEUR_COURANT);
            
        if (error) throw error;
        
        const countProduits = count || 0;
        const limitInfo = document.getElementById('productCount');
        const limitMessage = document.getElementById('productCountMessage');
        const submitBtn = document.getElementById('submitBtn');
        
        if (limitInfo) {
            limitInfo.textContent = `${countProduits}/${limiteProduits}`;
        }
        
        if (limitMessage) {
            limitMessage.textContent = `Vous avez ${countProduits} produit(s) sur ${limiteProduits} maximum`;
        }
        
        if (submitBtn && countProduits >= limiteProduits) {
            submitBtn.disabled = true;
            submitBtn.title = "Limite de produits atteinte (5 maximum)";
        }
        
    } catch (error) {
        console.error('Erreur vérification limite:', error);
    }
}

// ============================================
// 🔥 FONCTIONS DE GÉOLOCALISATION
// ============================================

/*// Initialiser la carte de localisation du produit
function initialiserCarteVendre() {
    console.log('🗺️ Initialisation carte vendre...');
    
    // Centre par défaut (Dakar)
    const dakarCenter = [14.7167, -17.4677];
    
    // Vérifier si l'élément map existe
    const mapElement = document.getElementById('mapVendre');
    if (!mapElement) {
        console.error('❌ Élément mapVendre non trouvé');
        return;
    }
    
    // Créer la carte
    mapVendre = L.map('mapVendre').setView(dakarCenter, 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(mapVendre);
    
    // Limiter à la région de Dakar
    const dakarBounds = L.latLngBounds(
        L.latLng(14.6, -17.6),
        L.latLng(14.8, -17.3)
    );
    mapVendre.setMaxBounds(dakarBounds);
    mapVendre.on('drag', function() {
        mapVendre.panInsideBounds(dakarBounds, { animate: false });
    });
    
    // Essayer d'obtenir la position exacte de l'utilisateur
    if (navigator.geolocation) {
        console.log('📍 Recherche de la position...');
        
        // Afficher un indicateur de chargement
        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'geoloc-loading';
        loadingMsg.id = 'geoloc-vendre-loading';
        loadingMsg.innerHTML = '<i class="fas fa-spinner fa-spin"></i>Recherche de votre position...';
        mapElement.parentNode.insertBefore(loadingMsg, mapElement);
        
        navigator.geolocation.getCurrentPosition(
            // Succès
            function(position) {
                console.log('✅ Position trouvée');
                
                // Supprimer l'indicateur
                const loadingEl = document.getElementById('geoloc-vendre-loading');
                if (loadingEl) loadingEl.remove();
                
                const userPos = [position.coords.latitude, position.coords.longitude];
                
                // Vérifier si dans les limites
                if (dakarBounds.contains(L.latLng(userPos[0], userPos[1]))) {
                    positionVendre = userPos;
                    mapVendre.setView(userPos, 15);
                    
                    markerVendre = L.marker(userPos, { draggable: true }).addTo(mapVendre);
                    markerVendre.bindPopup('📦 Votre produit est ici<br>Déplacez-moi si besoin').openPopup();
                    
                    // Mettre à jour les champs
                    document.getElementById('latitude').value = userPos[0].toFixed(6);
                    document.getElementById('longitude').value = userPos[1].toFixed(6);
                    
                    // Afficher un message de succès
                    afficherMessageLocalisation('success', 'Position trouvée ! Vous pouvez ajuster le marqueur si nécessaire.');
                } else {
                    console.log('⚠️ Position hors zone, utilisation de Dakar centre');
                    utiliserPositionDefaut(dakarCenter);
                    afficherMessageLocalisation('warning', 'Votre position est hors de la zone de livraison (Dakar). Le marqueur a été placé au centre de Dakar.');
                }
                
                ajouterEvenementsMarqueurVendre(dakarBounds);
            },
            // Erreur
            function(error) {
                console.warn('⚠️ Erreur géolocalisation:', error.message);
                
                const loadingEl = document.getElementById('geoloc-vendre-loading');
                if (loadingEl) loadingEl.remove();
                
                utiliserPositionDefaut(dakarCenter);
                
                let message = "Position par défaut (Dakar)";
                if (error.code === 1) {
                    message = "🌍 Position non partagée - Utilisation du centre de Dakar";
                } else if (error.code === 2) {
                    message = "📡 Position non disponible - Utilisation du centre de Dakar";
                } else if (error.code === 3) {
                    message = "⏱️ Délai dépassé - Utilisation du centre de Dakar";
                }
                
                afficherMessageLocalisation('warning', message);
                ajouterEvenementsMarqueurVendre(dakarBounds);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    } else {
        console.log('⚠️ Géolocalisation non supportée');
        utiliserPositionDefaut(dakarCenter);
        afficherMessageLocalisation('warning', 'Géolocalisation non supportée - Position par défaut (Dakar)');
        ajouterEvenementsMarqueurVendre(dakarBounds);
    }
}*/
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////



// ============================================
// 🔥 FONCTIONS DE GÉOLOCALISATION
// ============================================

// Variable pour savoir si on a déjà demandé la localisation
let geolocationDemandee = false;
let geolocationEnCours = false;

// Initialiser la carte de localisation du produit
function initialiserCarteVendre() {
    console.log('🗺️ Initialisation carte vendre...');
    
    // Centre par défaut (Dakar)
    const dakarCenter = [14.7167, -17.4677];
    
    // Vérifier si l'élément map existe
    const mapElement = document.getElementById('mapVendre');
    if (!mapElement) {
        console.error('❌ Élément mapVendre non trouvé');
        return;
    }
    
    // Créer la carte
    mapVendre = L.map('mapVendre').setView(dakarCenter, 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(mapVendre);
    
    // Limiter à la région de Dakar
    const dakarBounds = L.latLngBounds(
        L.latLng(14.6, -17.6),
        L.latLng(14.8, -17.3)
    );
    mapVendre.setMaxBounds(dakarBounds);
    mapVendre.on('drag', function() {
        mapVendre.panInsideBounds(dakarBounds, { animate: false });
    });
    
    // 🔥 Vérifier si on a déjà une position sauvegardée
    const positionSauvegardee = localStorage.getItem('userPosition');
    
    if (positionSauvegardee) {
        // Utiliser la position sauvegardée
        try {
            const pos = JSON.parse(positionSauvegardee);
            const userPos = [pos.lat, pos.lng];
            
            if (dakarBounds.contains(L.latLng(userPos[0], userPos[1]))) {
                positionVendre = userPos;
                mapVendre.setView(userPos, 15);
                
                markerVendre = L.marker(userPos, { draggable: true }).addTo(mapVendre);
                markerVendre.bindPopup('📦 Votre produit est ici<br>Déplacez-moi si besoin').openPopup();
                
                document.getElementById('latitude').value = userPos[0].toFixed(6);
                document.getElementById('longitude').value = userPos[1].toFixed(6);
                
                ajouterEvenementsMarqueurVendre(dakarBounds);
                return;
            }
        } catch (e) {
            console.warn('Erreur lecture position sauvegardée:', e);
        }
    }
    
    // 🔥 Si pas de position sauvegardée ET pas encore demandé
    if (!geolocationDemandee && !geolocationEnCours) {
        demanderLocalisationUneFois(dakarCenter, dakarBounds, mapElement);
    } else {
        // Position par défaut sans demander
        utiliserPositionDefaut(dakarCenter);
        ajouterEvenementsMarqueurVendre(dakarBounds);
    }
}

// 🔥 Fonction pour demander la localisation UNE SEULE fois
function demanderLocalisationUneFois(dakarCenter, dakarBounds, mapElement) {
    if (geolocationDemandee || geolocationEnCours) return;
    
    geolocationEnCours = true;
    
    if (navigator.geolocation) {
        console.log('📍 Demande de localisation...');
        
        // Afficher un indicateur de chargement
        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'geoloc-loading';
        loadingMsg.id = 'geoloc-vendre-loading';
        loadingMsg.innerHTML = '<i class="fas fa-spinner fa-spin"></i>Recherche de votre position...';
        mapElement.parentNode.insertBefore(loadingMsg, mapElement);
        
        navigator.geolocation.getCurrentPosition(
            // Succès
            function(position) {
                console.log('✅ Position trouvée');
                geolocationEnCours = false;
                geolocationDemandee = true;
                
                // Supprimer l'indicateur
                const loadingEl = document.getElementById('geoloc-vendre-loading');
                if (loadingEl) loadingEl.remove();
                
                const userPos = [position.coords.latitude, position.coords.longitude];
                
                // 🔥 Sauvegarder pour les prochaines visites
                localStorage.setItem('userPosition', JSON.stringify({
                    lat: userPos[0],
                    lng: userPos[1],
                    timestamp: Date.now()
                }));
                
                // Vérifier si dans les limites
                if (dakarBounds.contains(L.latLng(userPos[0], userPos[1]))) {
                    positionVendre = userPos;
                    mapVendre.setView(userPos, 15);
                    
                    if (markerVendre) markerVendre.remove();
                    markerVendre = L.marker(userPos, { draggable: true }).addTo(mapVendre);
                    markerVendre.bindPopup('📦 Votre produit est ici<br>Déplacez-moi si besoin').openPopup();
                    
                    document.getElementById('latitude').value = userPos[0].toFixed(6);
                    document.getElementById('longitude').value = userPos[1].toFixed(6);
                    
                    afficherMessageLocalisation('success', 'Position trouvée ! Vous pouvez ajuster le marqueur si nécessaire.');
                } else {
                    console.log('⚠️ Position hors zone, utilisation de Dakar centre');
                    utiliserPositionDefaut(dakarCenter);
                    afficherMessageLocalisation('warning', 'Votre position est hors de la zone de livraison (Dakar). Le marqueur a été placé au centre de Dakar.');
                }
                
                ajouterEvenementsMarqueurVendre(dakarBounds);
            },
            // Erreur
            function(error) {
                console.warn('⚠️ Erreur géolocalisation:', error.message);
                geolocationEnCours = false;
                geolocationDemandee = true; // 🔥 Marquer comme demandé même en erreur
                
                const loadingEl = document.getElementById('geoloc-vendre-loading');
                if (loadingEl) loadingEl.remove();
                
                utiliserPositionDefaut(dakarCenter);
                
                let message = "Position par défaut (Dakar)";
                if (error.code === 1) {
                    message = "🌍 Position non partagée - Utilisation du centre de Dakar";
                } else if (error.code === 2) {
                    message = "📡 Position non disponible - Utilisation du centre de Dakar";
                } else if (error.code === 3) {
                    message = "⏱️ Délai dépassé - Utilisation du centre de Dakar";
                }
                
                afficherMessageLocalisation('warning', message);
                ajouterEvenementsMarqueurVendre(dakarBounds);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    } else {
        console.log('⚠️ Géolocalisation non supportée');
        geolocationEnCours = false;
        geolocationDemandee = true;
        
        utiliserPositionDefaut(dakarCenter);
        afficherMessageLocalisation('warning', 'Géolocalisation non supportée - Position par défaut (Dakar)');
        ajouterEvenementsMarqueurVendre(dakarBounds);
    }
}

// Utiliser la position par défaut
function utiliserPositionDefaut(center) {
    positionVendre = center;
    
    if (markerVendre) markerVendre.remove();
    markerVendre = L.marker(center, { draggable: true }).addTo(mapVendre);
    markerVendre.bindPopup('📦 Déplacez-moi pour positionner votre produit').openPopup();
    
    document.getElementById('latitude').value = center[0].toFixed(6);
    document.getElementById('longitude').value = center[1].toFixed(6);
}

// Ajouter les événements du marqueur
function ajouterEvenementsMarqueurVendre(bounds) {
    if (!markerVendre) return;
    
    markerVendre.on('dragend', function(e) {
        const pos = e.target.getLatLng();
        
        // Vérifier les limites
        if (bounds.contains(pos)) {
            positionVendre = [pos.lat, pos.lng];
            document.getElementById('latitude').value = pos.lat.toFixed(6);
            document.getElementById('longitude').value = pos.lng.toFixed(6);
        } else {
            // Revenir dans les limites
            const lat = Math.min(Math.max(pos.lat, 14.6), 14.8);
            const lng = Math.min(Math.max(pos.lng, -17.6), -17.3);
            markerVendre.setLatLng([lat, lng]);
            positionVendre = [lat, lng];
            document.getElementById('latitude').value = lat.toFixed(6);
            document.getElementById('longitude').value = lng.toFixed(6);
            
            afficherMessageLocalisation('warning', 'Le marqueur a été repositionné dans la zone de livraison (Dakar)');
        }
    });
    
    mapVendre.on('click', function(e) {
        if (bounds.contains(e.latlng)) {
            markerVendre.setLatLng(e.latlng);
            positionVendre = [e.latlng.lat, e.latlng.lng];
            document.getElementById('latitude').value = e.latlng.lat.toFixed(6);
            document.getElementById('longitude').value = e.latlng.lng.toFixed(6);
        } else {
            afficherMessageLocalisation('warning', 'Veuillez choisir une position dans la zone de livraison (Dakar)');
        }
    });
}

// Recentrer sur la position de l'utilisateur
function recentrerCarteVendre() {
    if (navigator.geolocation) {
        afficherMessageLocalisation('info', 'Recherche de votre position...');
        
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const userPos = [position.coords.latitude, position.coords.longitude];
                mapVendre.setView(userPos, 15);
                
                if (markerVendre) {
                    markerVendre.setLatLng(userPos);
                } else {
                    markerVendre = L.marker(userPos, { draggable: true }).addTo(mapVendre);
                }
                
                positionVendre = userPos;
                document.getElementById('latitude').value = userPos[0].toFixed(6);
                document.getElementById('longitude').value = userPos[1].toFixed(6);
                
                // 🔥 Mettre à jour la position sauvegardée
                localStorage.setItem('userPosition', JSON.stringify({
                    lat: userPos[0],
                    lng: userPos[1],
                    timestamp: Date.now()
                }));
                
                afficherMessageLocalisation('success', 'Position mise à jour !');
            },
            function(error) {
                let message = "Impossible d'obtenir votre position";
                if (error.code === 1) message = "Veuillez autoriser la géolocalisation";
                else if (error.code === 2) message = "Position non disponible";
                else if (error.code === 3) message = "Délai dépassé";
                
                afficherMessageLocalisation('danger', message);
            }
        );
    } else {
        afficherMessageLocalisation('danger', 'Géolocalisation non supportée');
    }
}

// Afficher un message dans la zone de localisation
function afficherMessageLocalisation(type, message) {
    const messagesContainer = document.getElementById('localisationMessages');
    if (!messagesContainer) return;
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-localisation`;
    alertDiv.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>${message}`;
    
    messagesContainer.innerHTML = '';
    messagesContainer.appendChild(alertDiv);
    
    // Auto-suppression après 5 secondes
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}

// 🔥 Optionnel : Effacer la position sauvegardée (pour test)
function effacerPositionSauvegardee() {
    localStorage.removeItem('userPosition');
    console.log('🗑️ Position sauvegardée effacée');
    window.location.reload();
}













///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Utiliser la position par défaut
function utiliserPositionDefaut(center) {
    positionVendre = center;
    markerVendre = L.marker(center, { draggable: true }).addTo(mapVendre);
    markerVendre.bindPopup('📦 Déplacez-moi pour positionner votre produit').openPopup();
    
    document.getElementById('latitude').value = center[0].toFixed(6);
    document.getElementById('longitude').value = center[1].toFixed(6);
}

// Ajouter les événements du marqueur
function ajouterEvenementsMarqueurVendre(bounds) {
    if (!markerVendre) return;
    
    markerVendre.on('dragend', function(e) {
        const pos = e.target.getLatLng();
        
        // Vérifier les limites
        if (bounds.contains(pos)) {
            positionVendre = [pos.lat, pos.lng];
            document.getElementById('latitude').value = pos.lat.toFixed(6);
            document.getElementById('longitude').value = pos.lng.toFixed(6);
        } else {
            // Revenir dans les limites
            const lat = Math.min(Math.max(pos.lat, 14.6), 14.8);
            const lng = Math.min(Math.max(pos.lng, -17.6), -17.3);
            markerVendre.setLatLng([lat, lng]);
            positionVendre = [lat, lng];
            document.getElementById('latitude').value = lat.toFixed(6);
            document.getElementById('longitude').value = lng.toFixed(6);
            
            afficherMessageLocalisation('warning', 'Le marqueur a été repositionné dans la zone de livraison (Dakar)');
        }
    });
    
    mapVendre.on('click', function(e) {
        if (bounds.contains(e.latlng)) {
            markerVendre.setLatLng(e.latlng);
            positionVendre = [e.latlng.lat, e.latlng.lng];
            document.getElementById('latitude').value = e.latlng.lat.toFixed(6);
            document.getElementById('longitude').value = e.latlng.lng.toFixed(6);
        } else {
            afficherMessageLocalisation('warning', 'Veuillez choisir une position dans la zone de livraison (Dakar)');
        }
    });
}

// Recentrer sur la position de l'utilisateur
function recentrerCarteVendre() {
    if (navigator.geolocation) {
        afficherMessageLocalisation('info', 'Recherche de votre position...');
        
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const userPos = [position.coords.latitude, position.coords.longitude];
                mapVendre.setView(userPos, 15);
                markerVendre.setLatLng(userPos);
                positionVendre = userPos;
                document.getElementById('latitude').value = userPos[0].toFixed(6);
                document.getElementById('longitude').value = userPos[1].toFixed(6);
                
                afficherMessageLocalisation('success', 'Position mise à jour !');
            },
            function(error) {
                let message = "Impossible d'obtenir votre position";
                if (error.code === 1) message = "Veuillez autoriser la géolocalisation";
                else if (error.code === 2) message = "Position non disponible";
                else if (error.code === 3) message = "Délai dépassé";
                
                afficherMessageLocalisation('danger', message);
            }
        );
    } else {
        afficherMessageLocalisation('danger', 'Géolocalisation non supportée');
    }
}

// Afficher un message dans la zone de localisation
function afficherMessageLocalisation(type, message) {
    const messagesContainer = document.getElementById('localisationMessages');
    if (!messagesContainer) return;
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-localisation`;
    alertDiv.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>${message}`;
    
    messagesContainer.innerHTML = '';
    messagesContainer.appendChild(alertDiv);
    
    // Auto-suppression après 5 secondes
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}

// ============================================
// PUBLIER LE PRODUIT AVEC LOCALISATION
// ============================================

// Publier un produit avec upload d'images compressées ET localisation
async function publierProduit(e) {
    e.preventDefault();
    
    if (vendreLoading) return;
    
    // Récupérer les valeurs
    const titre = document.getElementById('titre')?.value.trim();
    const categorie = document.getElementById('categorie')?.value;
    const prix = parseFloat(document.getElementById('prix')?.value);
    const etat = document.getElementById('etat')?.value;
    const marque = document.getElementById('marque')?.value.trim();
    const modele = document.getElementById('modele')?.value.trim();
    const couleur = document.getElementById('couleur')?.value.trim();
    const description = document.getElementById('description')?.value.trim();
    
    // 🔥 Récupérer la position
    const latitude = positionVendre ? positionVendre[0] : null;
    const longitude = positionVendre ? positionVendre[1] : null;
    
    // Validations
    if (!titre || !categorie || !prix || !etat || !description) {
        alert('Veuillez remplir tous les champs obligatoires.');
        return;
    }
    
    if (prix < 100) {
        alert('Le prix minimum est de 100 FCFA.');
        return;
    }
    
    if (imagesSelectionnees.length === 0) {
        alert('Veuillez ajouter au moins une photo.');
        return;
    }
    
    // 🔥 Vérifier la position (optionnel mais recommandé)
    if (!latitude || !longitude) {
        if (!confirm('Vous n\'avez pas sélectionné de position. Voulez-vous continuer sans localisation ?')) {
            return;
        }
    }
    
    setVendreLoading(true);
    
    try {
        // Uploader les images vers Supabase Storage
        console.log('📤 Upload des images vers le bucket "photos"...');
        const imageUrls = await uploaderPlusieursImages(imagesSelectionnees);
        
        if (imageUrls.length === 0) {
            throw new Error('Aucune image n\'a pu être uploadée');
        }
        
        console.log(`✅ ${imageUrls.length} images uploadées avec succès`);
        
        // 🔥 Créer le produit AVEC la position
        const nouveauProduit = {
            titre,
            categorie,
            prix,
            etat,
            marque: marque || null,
            modele: modele || null,
            couleur: couleur || null,
            description,
            image_url: imageUrls[0] || null,
            images: imageUrls,
            vendeur_id: UTILISATEUR_COURANT,
            est_actif: true,
            created_at: new Date().toISOString(),
            latitude: latitude,    // 🔥 Nouveau champ
            longitude: longitude   // 🔥 Nouveau champ
        };
        
        console.log('📦 Publication du produit avec localisation:', { latitude, longitude });
        
        const { error } = await supabase1
            .from('produits')
            .insert([nouveauProduit]);
            
        if (error) throw error;
        
        alert('✅ Produit publié avec succès !');
        window.location.href = 'mes-produits.html';
        
    } catch (error) {
        console.error('❌ Erreur publication:', error);
        alert('❌ Erreur lors de la publication: ' + error.message);
    } finally {
        setVendreLoading(false);
    }
}

// Gérer l'état de chargement
function setVendreLoading(loading) {
    vendreLoading = loading;
    const btn = document.getElementById('submitBtn');
    const btnText = document.getElementById('submitText');
    const btnSpinner = document.getElementById('submitSpinner');
    
    if (btn && btnText && btnSpinner) {
        btn.disabled = loading;
        if (loading) {
            btnText.classList.add('d-none');
            btnSpinner.classList.remove('d-none');
        } else {
            btnText.classList.remove('d-none');
            btnSpinner.classList.add('d-none');
        }
    }
}

// 🔥 Rendre la fonction accessible globalement
window.recentrerCarteVendre = recentrerCarteVendre;
window.supprimerImage = supprimerImage;







// ============================================
// PAGE MES PRODUITS
// ============================================

let mesProduits = [];
let editModal = null;

// Initialiser la page mes produits
function initialiserPageMesProduits() {
    console.log('📦 Initialisation page mes produits...');
    
    verifierConnexionVendeur();
    chargerMesProduits();



    verifierVentesEnAttente();

    
    const modalElement = document.getElementById('editModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        editModal = new bootstrap.Modal(modalElement);
    }
}

// Charger les produits du vendeur
async function chargerMesProduits() {
    // Attendre que l'utilisateur soit chargé
    await attendreUtilisateur();
    
    if (!UTILISATEUR_COURANT || !supabase1) return;

    initialiserCompteurVentes();     // ✅ À GARDER
    
    try {
        const { data, error } = await supabase1
            .from('produits')
            .select('*')
            .eq('vendeur_id', UTILISATEUR_COURANT)
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        mesProduits = data || [];
        
        // Mettre à jour l'affichage
        const loadingIndicator = document.getElementById('loadingIndicator');
        const emptyState = document.getElementById('emptyState');
        const produitsContainer = document.getElementById('produitsContainer');
        const countElement = document.getElementById('productCount');
        const countMessage = document.getElementById('productCountMessage');
        
        if (loadingIndicator) loadingIndicator.classList.add('d-none');
        
        if (mesProduits.length === 0) {
            if (emptyState) emptyState.classList.remove('d-none');
            if (produitsContainer) produitsContainer.classList.add('d-none');
        } else {
            if (emptyState) emptyState.classList.add('d-none');
            if (produitsContainer) produitsContainer.classList.remove('d-none');
            afficherMesProduits();
        }
        
        // Mettre à jour le compteur
        if (countElement) {
            countElement.textContent = `${mesProduits.length}/${limiteProduits}`;
        }
        
        if (countMessage) {
            countMessage.textContent = `Vous avez ${mesProduits.length} produit(s) sur ${limiteProduits} maximum`;
        }
        
    } catch (error) {
        console.error('Erreur chargement produits:', error);
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator) {
            loadingIndicator.innerHTML = `
                <div class="text-center text-danger">
                    <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                    <p>Erreur de chargement</p>
                    <button class="btn btn-primary mt-2" onclick="location.reload()">Réessayer</button>
                </div>
            `;
        }
    }
}

// Afficher les produits
function afficherMesProduits() {
    const grid = document.getElementById('produitsGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    mesProduits.forEach(produit => {
        const col = document.createElement('div');
        col.className = 'col-md-6 col-lg-4';
        
        const imageUrl = produit.image_url || produit.images?.[0] || 'image/default-product.jpg';
        const badgeClass = produit.est_actif ? 'badge-actif' : 'badge-inactif';
        const badgeTexte = produit.est_actif ? 'Actif' : 'Inactif';
        
        col.innerHTML = `
            <div class="produit-card">
                <span class="badge-statut ${badgeClass}">${badgeTexte}</span>
                <img src="${imageUrl}" alt="${produit.titre}" class="produit-image" onerror="this.src='image/default-product.jpg'">
                <div class="produit-contenu">
                    <h3 class="produit-titre">${produit.titre || 'Sans titre'}</h3>
                    <div class="produit-prix">${produit.prix ? produit.prix.toLocaleString() : '0'} FCFA</div>
                    <div class="text-muted small">
                        <i class="fas fa-tag me-1"></i>${produit.categorie || 'Non catégorisé'}
                    </div>
                    ${produit.nombre_vues ? `
                        <div class="text-muted small mt-2">
                            <i class="fas fa-eye me-1"></i>${produit.nombre_vues} vues
                        </div>
                    ` : ''}
                </div>
                <div class="produit-actions">
                    <button class="btn-action btn-modifier" onclick="ouvrirModification('${produit.id}')">
                        <i class="fas fa-edit me-1"></i>Modifier
                    </button>
                    <button class="btn-action btn-supprimer" onclick="confirmerSuppression('${produit.id}')">
                        <i class="fas fa-trash me-1"></i>Supprimer
                    </button>
                </div>
            </div>
        `;
        
        grid.appendChild(col);
    });
}

// Ouvrir le modal de modification
async function ouvrirModification(produitId) {
    const produit = mesProduits.find(p => p.id === produitId);
    if (!produit) return;
    
    const modalBody = document.getElementById('editModalBody');
    if (!modalBody) return;
    
    modalBody.innerHTML = `
        <form id="editForm">
            <input type="hidden" id="editId" value="${produit.id}">
            
            <div class="mb-3">
                <label class="form-label">Titre *</label>
                <input type="text" class="form-control" id="editTitre" 
                       value="${produit.titre || ''}" required>
            </div>
            
            <div class="mb-3">
                <label class="form-label">Catégorie *</label>
                <select class="form-select" id="editCategorie" required>
                    <option value="Électronique" ${produit.categorie === 'Électronique' ? 'selected' : ''}>📱 Électronique</option>
                    <option value="Mode" ${produit.categorie === 'Mode' ? 'selected' : ''}>👕 Mode</option>
                    <option value="Maison" ${produit.categorie === 'Maison' ? 'selected' : ''}>🏠 Maison</option>
                    <option value="Loisirs" ${produit.categorie === 'Loisirs' ? 'selected' : ''}>🎮 Loisirs</option>
                    <option value="Sports" ${produit.categorie === 'Sports' ? 'selected' : ''}>⚽ Sports</option>
                    <option value="Véhicules" ${produit.categorie === 'Véhicules' ? 'selected' : ''}>🚗 Véhicules</option>
                    <option value="Autre" ${produit.categorie === 'Autre' ? 'selected' : ''}>📦 Autre</option>
                </select>
            </div>
            
            <div class="mb-3">
                <label class="form-label">Prix (FCFA) *</label>
                <input type="number" class="form-control" id="editPrix" 
                       value="${produit.prix || ''}" min="100" step="100" required>
            </div>
            
            <div class="mb-3">
                <label class="form-label">État *</label>
                <select class="form-select" id="editEtat" required>
                    <option value="neuf" ${produit.etat === 'neuf' ? 'selected' : ''}>Neuf</option>
                    <option value="très bon état" ${produit.etat === 'très bon état' ? 'selected' : ''}>Très bon état</option>
                    <option value="bon état" ${produit.etat === 'bon état' ? 'selected' : ''}>Bon état</option>
                    <option value="état satisfaisant" ${produit.etat === 'état satisfaisant' ? 'selected' : ''}>État satisfaisant</option>
                    <option value="à réparer" ${produit.etat === 'à réparer' ? 'selected' : ''}>À réparer</option>
                </select>
            </div>
            
            <div class="mb-3">
                <label class="form-label">Marque</label>
                <input type="text" class="form-control" id="editMarque" value="${produit.marque || ''}">
            </div>
            
            <div class="mb-3">
                <label class="form-label">Modèle</label>
                <input type="text" class="form-control" id="editModele" value="${produit.modele || ''}">
            </div>
            
            <div class="mb-3">
                <label class="form-label">Couleur</label>
                <input type="text" class="form-control" id="editCouleur" value="${produit.couleur || ''}">
            </div>
            
            <div class="mb-3">
                <label class="form-label">Description *</label>
                <textarea class="form-control" id="editDescription" rows="4" required>${produit.description || ''}</textarea>
            </div>
            
            <div class="mb-3 form-check">
                <input type="checkbox" class="form-check-input" id="editActif" ${produit.est_actif ? 'checked' : ''}>
                <label class="form-check-label">Annonce active</label>
            </div>
            
            <div class="d-flex gap-2">
                <button type="submit" class="btn btn-primary flex-grow-1">
                    <span id="editText">Enregistrer</span>
                    <span id="editSpinner" class="spinner-border spinner-border-sm d-none"></span>
                </button>
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annuler</button>
            </div>
        </form>
    `;
    
    document.getElementById('editForm').addEventListener('submit', enregistrerModification);
    
    if (editModal) editModal.show();
}

// Enregistrer la modification
async function enregistrerModification(e) {
    e.preventDefault();
    
    const id = document.getElementById('editId').value;
    const titre = document.getElementById('editTitre').value.trim();
    const categorie = document.getElementById('editCategorie').value;
    const prix = parseFloat(document.getElementById('editPrix').value);
    const etat = document.getElementById('editEtat').value;
    const marque = document.getElementById('editMarque').value.trim();
    const modele = document.getElementById('editModele').value.trim();
    const couleur = document.getElementById('editCouleur').value.trim();
    const description = document.getElementById('editDescription').value.trim();
    const estActif = document.getElementById('editActif').checked;
    
    try {
        const { error } = await supabase1
            .from('produits')
            .update({
                titre,
                categorie,
                prix,
                etat,
                marque: marque || null,
                modele: modele || null,
                couleur: couleur || null,
                description,
                est_actif: estActif,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);
            
        if (error) throw error;
        
        if (editModal) editModal.hide();
        
        alert('✅ Produit modifié avec succès');
        chargerMesProduits();
        
    } catch (error) {
        console.error('Erreur modification:', error);
        alert('❌ Erreur lors de la modification');
    }
}

// Confirmer la suppression
function confirmerSuppression(produitId) {
    if (confirm('Voulez-vous vraiment supprimer ce produit ? Cette action est irréversible.')) {
        supprimerProduit(produitId);
    }
}

// Supprimer un produit
async function supprimerProduit(produitId) {
    try {
        const { error } = await supabase1
            .from('produits')
            .delete()
            .eq('id', produitId);
            
        if (error) throw error;
        
        alert('✅ Produit supprimé avec succès');
        chargerMesProduits();
        
    } catch (error) {
        console.error('Erreur suppression:', error);
        alert('❌ Erreur lors de la suppression');
    }
}







// ============================================
// COMPTEUR DE COMMANDES EN ATTENTE POUR LES VENTES
// ============================================

let commandesVentesEnAttente = 0;
let verificationVentesInterval = null;

// Initialiser le compteur de commandes en attente pour les ventes
function initialiserCompteurVentes() {
    console.log('🔢 Initialisation du compteur de ventes en attente...');
    
    // Vérifier si l'utilisateur est connecté
    if (!UTILISATEUR_COURANT) {
        console.log('👤 Utilisateur non connecté, pas de compteur');
        return;
    }
    
    // Vérifier immédiatement
    verifierVentesEnAttente();
    
    // Vérifier toutes les 30 secondes
    if (verificationVentesInterval) {
        clearInterval(verificationVentesInterval);
    }
    verificationVentesInterval = setInterval(verifierVentesEnAttente, 30000);
    
    // Ajouter un écouteur pour la visibilité de la page
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden && UTILISATEUR_COURANT) {
            console.log('👁️ Page visible, vérification des ventes...');
            verifierVentesEnAttente();
        }
    });
    
    // Écouter les changements d'authentification
    if (supabase1) {
        supabase1.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                console.log('🔢 Connexion détectée, activation compteur ventes');
                UTILISATEUR_COURANT = session.user.id;
                verifierVentesEnAttente();
                
                if (!verificationVentesInterval) {
                    verificationVentesInterval = setInterval(verifierVentesEnAttente, 30000);
                }
            } else if (event === 'SIGNED_OUT') {
                console.log('🔢 Déconnexion détectée, désactivation compteur ventes');
                cacherCompteurVentes();
                if (verificationVentesInterval) {
                    clearInterval(verificationVentesInterval);
                    verificationVentesInterval = null;
                }
            }
        });
    }
}

// Vérifier les ventes en attente de livraison
async function verifierVentesEnAttente() {
    if (!UTILISATEUR_COURANT || !supabase1) {
        console.log('❌ Pas d\'utilisateur connecté ou Supabase non initialisé');
        return;
    }
    
    try {
        console.log('🔍 Vérification des ventes en attente pour:', UTILISATEUR_COURANT);
        
        // 🔥 Compter UNIQUEMENT les commandes en attente de livraison où l'utilisateur est vendeur
        const { count, error } = await supabase1
            .from('commandes')
            .select('*', { count: 'exact', head: true })
            .eq('id_vendeur', UTILISATEUR_COURANT)
            .eq('etat', 'en attente de livraison');
        
        if (error) {
            console.error('❌ Erreur vérification ventes:', error);
            return;
        }
        
        console.log('📊 Commandes en attente trouvées:', count);
        
        const nouveauCompte = count || 0;
        
        if (nouveauCompte !== commandesVentesEnAttente) {
            console.log(`📦 Ventes en attente: ${nouveauCompte}`);
            commandesVentesEnAttente = nouveauCompte;
            mettreAJourCompteurVentes();
        } else {
            console.log('ℹ️ Pas de changement');
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la vérification des ventes:', error);
    }
}

// Mettre à jour l'affichage du compteur sur le lien du dashboard ET dans le dropdown
function mettreAJourCompteurVentes() {
    const compteurDashboard = document.getElementById('commandes-ventes-attente');
    const compteurDropdown = document.getElementById('dropdown-ventes-attente');
    
    const valeur = commandesVentesEnAttente > 99 ? '99+' : commandesVentesEnAttente;
    
    // Mettre à jour le badge dans le dashboard
    if (compteurDashboard) {
        if (commandesVentesEnAttente > 0) {
            compteurDashboard.textContent = valeur;
            compteurDashboard.style.display = 'inline';
            
            // Animation
            compteurDashboard.style.animation = 'none';
            compteurDashboard.offsetHeight;
            compteurDashboard.style.animation = 'compteur-pulse 0.5s ease';
        } else {
            compteurDashboard.style.display = 'none';
        }
    }
    
    // Mettre à jour le badge dans le dropdown
    if (compteurDropdown) {
        if (commandesVentesEnAttente > 0) {
            compteurDropdown.textContent = valeur;
            compteurDropdown.style.display = 'inline';
        } else {
            compteurDropdown.style.display = 'none';
        }
    }
}

// Cacher le compteur
function cacherCompteurVentes() {
    commandesVentesEnAttente = 0;
    mettreAJourCompteurVentes();
}

// Réinitialiser le compteur quand on consulte la page (optionnel)
function reinitialiserCompteurVentes() {
    console.log('📊 Page historique ventes consultée, réinitialisation du compteur');
    // Note: On ne réinitialise pas le compteur ici car on veut toujours afficher
    // les commandes en attente, même sur la page d'historique
    // Si vous voulez le cacher quand on est sur la page, décommentez la ligne suivante :
    // cacherCompteurVentes();
}

// Animation CSS (si pas déjà présente)
if (!document.querySelector('#compteur-style')) {
    const styleCompteur = document.createElement('style');
    styleCompteur.id = 'compteur-style';
    styleCompteur.textContent = `
    @keyframes compteur-pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.2); }
        100% { transform: scale(1); }
    }
    `;
    document.head.appendChild(styleCompteur);
}






// ============================================
// PAGE HISTORIQUE VENTES
// ============================================

let ventes = [];
let ventesInitialized = false;
let ventesTimeout = null;


// Initialiser la page historique ventes
async function initialiserPageHistoriqueVentes() {
    console.log('📊 Initialisation page historique ventes...');
    
    // Initialiser le dropdown utilisateur
    //initialiserDropdownUtilisateur();

    
    // D'abord, attendre que l'utilisateur soit complètement chargé
    console.log('⏳ Attente du chargement de l\'utilisateur...');
    const estConnecte = await verifierConnexion();
    
    if (!estConnecte) {
        console.log('❌ Utilisateur non connecté, redirection vers connexion');
        window.location.href = 'connexion.html?redirect=historique-ventes';
        return;
    }
    
    console.log('✅ Utilisateur connecté, chargement des données...');
    
    // Charger les infos utilisateur et mettre à jour l'interface
    await chargerInfosUtilisateur();
    afficherUtilisateurConnecte();


    verifierVentesEnAttente();
    
    // Charger les ventes
    await chargerVentes();
    
    // Timeout de sécurité
    ventesTimeout = setTimeout(() => {
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator && !loadingIndicator.classList.contains('d-none')) {
            console.log('⏰ Timeout de chargement');
            if (loadingIndicator) {
                loadingIndicator.innerHTML = `
                    <div class="text-center">
                        <i class="fas fa-exclamation-triangle fa-3x text-danger mb-3"></i>
                        <h4 class="text-danger">Erreur de chargement</h4>
                        <p class="text-muted">Le chargement prend trop de temps. Veuillez réessayer.</p>
                        <button class="btn btn-primary mt-3" onclick="location.reload()">
                            <i class="fas fa-redo me-2"></i>Réessayer
                        </button>
                    </div>
                `;
            }
        }
    }, 15000);
}

// Charger les ventes
async function chargerVentes() {
    if (!UTILISATEUR_COURANT) {
        console.error('❌ Utilisateur non connecté');
        afficherMessageVentes('Utilisateur non connecté', 'error');
        return;
    }
    
    if (!supabase1) {
        console.error('❌ Supabase non initialisé');
        afficherMessageVentes('Erreur de connexion à la base de données', 'error');
        return;
    }

    try {
        console.log('📦 Chargement des ventes pour:', UTILISATEUR_COURANT);

        // Récupérer les commandes avec les infos du produit
        const { data, error } = await supabase1
            .from('commandes')
            .select(`
                *,
                acheteur:utilisateurs!id_acheteur(nom, email, telephone),
                produit:produits!id_produit(titre, image_url, prix)
            `)
            .eq('id_vendeur', UTILISATEUR_COURANT)
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        ventes = data || [];
        
        console.log(`✅ ${ventes.length} ventes chargées`);
        console.log('📊 Données brutes:', ventes);

        // LOG SUPPLÉMENTAIRE : Afficher la première vente en détail
        if (ventes.length > 0) {
            console.log('🔍 Détail de la première vente:', {
                id: ventes[0].id,
                code: ventes[0].code_unique,
                prix: ventes[0].prix,
                etat: ventes[0].etat,
                produit: ventes[0].produit,
                acheteur: ventes[0].acheteur
            });
        }

        // Récupérer les éléments DOM APRÈS avoir les données
        const loadingIndicator = document.getElementById('loadingIndicator');
        const emptyState = document.getElementById('emptyState');
        const ventesContainer = document.getElementById('ventesContainer');
        const statsVentes = document.getElementById('statsVentes');
        
        // Vérifier que tous les éléments existent
        console.log('🔍 Éléments DOM:', {
            loadingIndicator: !!loadingIndicator,
            emptyState: !!emptyState,
            ventesContainer: !!ventesContainer,
            statsVentes: !!statsVentes
        });

        // Logs de débogage (après déclaration des variables)
        console.log("🧪 ventes length =", ventes.length);
        console.log("🧪 ventesContainer =", ventesContainer);
        console.log("🧪 ventesContainer classes =", ventesContainer?.className);
        
        if (loadingIndicator) loadingIndicator.classList.add('d-none');

        if (ventes.length === 0) {
            console.log('📭 Aucune vente trouvée');
            if (emptyState) {
                emptyState.classList.remove('d-none');
                emptyState.innerHTML = `
                    <i class="fas fa-history"></i>
                    <h3 class="mb-3">Aucune vente pour le moment</h3>
                    <p class="text-muted mb-4">Vos ventes apparaîtront ici dès que des acheteurs commanderont vos articles.</p>
                    <a href="vendre.html" class="btn btn-primary">
                        <i class="fas fa-plus-circle me-2"></i>Publier un article
                    </a>
                `;
            }
            if (ventesContainer) ventesContainer.classList.add('d-none');
            if (statsVentes) statsVentes.classList.add('d-none');
        } else {
            console.log('📦 Affichage des ventes');
            if (emptyState) emptyState.classList.add('d-none');
            if (ventesContainer) {
                ventesContainer.classList.remove('d-none');
                afficherVentes();
            } else {
                console.error('❌ ventesContainer non trouvé dans le DOM');
            }
            if (statsVentes) {
                statsVentes.classList.remove('d-none');
                calculerStatistiques();
            }
        }

        annulerTimeoutVentes();
        
    } catch (error) {
        console.error('❌ Erreur chargement ventes:', error);
        afficherMessageVentes('Erreur lors du chargement des ventes: ' + error.message, 'error');
        
        const loadingIndicator = document.getElementById('loadingIndicator');
        const emptyState = document.getElementById('emptyState');
        
        if (loadingIndicator) loadingIndicator.classList.add('d-none');
        if (emptyState) {
            emptyState.classList.remove('d-none');
            emptyState.innerHTML = `
                <i class="fas fa-exclamation-triangle text-danger"></i>
                <h3 class="mb-3">Erreur de chargement</h3>
                <p class="text-muted mb-4">${error.message}</p>
                <button class="btn btn-primary mt-2" onclick="location.reload()">
                    <i class="fas fa-redo me-2"></i>Réessayer
                </button>
            `;
        }
        
        annulerTimeoutVentes();
    }
}

// Afficher les ventes
function afficherVentes() {
    console.log('🖼️ Début affichage des ventes');
    const container = document.getElementById('ventesContainer');
    if (!container) {
        console.error('❌ Container ventesContainer non trouvé');
        return;
    }
    
    console.log(`📦 ${ventes.length} ventes à afficher`);
    console.log('📊 ventes array:', ventes);
    
    container.innerHTML = '';
    
    ventes.forEach((vente, index) => {
        console.log(`🔄 Traitement vente ${index + 1}:`, vente.id);
        
        const card = document.createElement('div');
        card.className = 'vente-card';
        
        const date = new Date(vente.created_at).toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let badgeClass = '';
        let badgeIcon = '';
        let badgeTexte = vente.etat || 'En attente de livraison';
        
        switch(vente.etat) {
            case 'livrée':
                badgeClass = 'badge-livree';
                badgeIcon = 'fa-check-circle';
                break;
            case 'annulée':
                badgeClass = 'badge-annulee';
                badgeIcon = 'fa-times-circle';
                break;
            case 'en cours de livraison':
                badgeClass = 'badge-cours';
                badgeIcon = 'fa-truck';
                badgeTexte = 'En cours de livraison';
                break;
            case 'préparée':
                badgeClass = 'badge-attente';
                badgeIcon = 'fa-box';
                badgeTexte = 'Préparée';
                break;
            default:
                badgeClass = 'badge-attente';
                badgeIcon = 'fa-clock';
                badgeTexte = 'En attente de livraison';
        }
        
        // Prix de la commande (au moment de l'achat)
        const prixCommande = vente.prix || 0;
        
        // Prix actuel du produit (optionnel, pour comparaison)
        const prixProduit = vente.produit?.prix || 0;
        
        const imageUrl = vente.produit?.image_url || vente.imageUrl || 'image/default-product.jpg';
        const titre = vente.produit?.titre || 'Produit inconnu';
        
        // Calculer la différence de prix si nécessaire
        const afficherDifference = prixProduit > 0 && prixProduit !== prixCommande;
        
        console.log(`🖼️ Image: ${imageUrl}, Titre: ${titre}, Prix commande: ${prixCommande}, Prix produit: ${prixProduit}`);
        
        card.innerHTML = `
            <div class="vente-header">
                <span class="vente-date"><i class="fas fa-calendar me-2"></i>${date}</span>
                <span class="vente-code"><i class="fas fa-qrcode me-2"></i>${vente.code_unique || 'N/A'}</span>
            </div>
            <div class="vente-body">
                <div class="acheteur-info">
                    <strong><i class="fas fa-user me-2"></i>Acheteur:</strong>
                    <div>${vente.acheteur?.nom || 'Non renseigné'}</div>
                </div>
                
                <div class="produit-info">
                    <img src="${imageUrl}" 
                         alt="${titre}" 
                         class="produit-image"
                         onerror="this.src='image/default-product.jpg'">
                    <div class="produit-details">
                        <div class="produit-nom">${titre}</div>
                        <div class="produit-prix">
                            ${prixProduit.toLocaleString()} FCFA
                        </div>
                    </div>
                </div>
                
                <div class="d-flex justify-content-between align-items-center mt-3">
                    <span class="badge-etat ${badgeClass}">
                        <i class="fas ${badgeIcon} me-1"></i>
                        ${badgeTexte}
                    </span>
                    <div class="text-end">
                        ${vente.paiement_recu ? 
                            '<span class="text-success"><i class="fas fa-check-circle me-1"></i>Paiement reçu</span>' : 
                            '<span class="text-warning"><i class="fas fa-clock me-1"></i>Paiement en attente</span>'}
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(card);
    });
    
    console.log('✅ Affichage des ventes terminé, éléments dans container:', container.children.length);
}

// Calculer les statistiques
/*function calculerStatistiques() {
    console.log('📊 Calcul des statistiques');
    
    const totalVentes = ventes.length;
    const chiffreAffaires = ventes.reduce((sum, v) => sum + (v.produit?.prix || 0), 0);
    const ventesEnCours = ventes.filter(v => v.etat !== 'livrée' && v.etat !== 'annulée').length;
    const ventesLivrees = ventes.filter(v => v.etat === 'livrée').length;

    console.log('📈 Statistiques:', { totalVentes, chiffreAffaires, ventesEnCours, ventesLivrees });
    
    const totalVentesEl = document.getElementById('totalVentes');
    const chiffreAffairesEl = document.getElementById('chiffreAffaires');
    const ventesEnCoursEl = document.getElementById('ventesEnCours');
    const ventesLivreesEl = document.getElementById('ventesLivrees');
    
    if (totalVentesEl) totalVentesEl.textContent = totalVentes;
    if (chiffreAffairesEl) chiffreAffairesEl.textContent = chiffreAffaires.toLocaleString() + ' FCFA';
    if (ventesEnCoursEl) ventesEnCoursEl.textContent = ventesEnCours;
    if (ventesLivreesEl) ventesLivreesEl.textContent = ventesLivrees;
}*/


// Calculer les statistiques
function calculerStatistiques() {
    console.log('📊 Calcul des statistiques');
    
    // 🔥 Filtrer UNIQUEMENT les ventes livrées
    const ventesLivrees = ventes.filter(v => v.etat === 'livrée');
    
    // Total des ventes (toutes commandes confondues)
    const totalToutesVentes = ventes.length;
    
    // 🔥 Chiffre d'affaires = somme des prix des ventes livrées UNIQUEMENT
    const chiffreAffaires = ventesLivrees.reduce((sum, v) => {
        // Utiliser le prix de la commande (ou du produit si disponible)
        const prix = v.produit?.prix || 0;
        return sum + prix;
    }, 0);


    
    // Ventes en cours (tout sauf livrée et annulée)
    const ventesEnCours = ventes.filter(v => v.etat !== 'livrée' && v.etat !== 'annulée').length;
    
    // Nombre de ventes livrées
    const nombreVentesLivrees = ventesLivrees.length;

    console.log('📈 Statistiques:', { 
        totalToutesVentes, 
        chiffreAffaires, 
        ventesEnCours, 
        nombreVentesLivrees 
    });
    
    // Mettre à jour les éléments DOM
    const totalVentesEl = document.getElementById('totalVentes');
    const chiffreAffairesEl = document.getElementById('chiffreAffaires');
    const ventesEnCoursEl = document.getElementById('ventesEnCours');
    const ventesLivreesEl = document.getElementById('ventesLivrees');
    
    if (totalVentesEl) totalVentesEl.textContent = totalToutesVentes;
    if (chiffreAffairesEl) chiffreAffairesEl.textContent = chiffreAffaires.toLocaleString() + ' FCFA';
    if (ventesEnCoursEl) ventesEnCoursEl.textContent = ventesEnCours;
    if (ventesLivreesEl) ventesLivreesEl.textContent = nombreVentesLivrees;
}

// Fonction pour annuler le timeout
function annulerTimeoutVentes() {
    if (ventesTimeout) {
        clearTimeout(ventesTimeout);
        ventesTimeout = null;
    }
}

// Afficher un message
function afficherMessageVentes(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show position-fixed`;
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '1050';
    alertDiv.style.minWidth = '300px';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) alertDiv.remove();
    }, 5000);
}


/*// ============================================
// PAGE HISTORIQUE DES COMMANDES - AVEC ANNULATION (ACHATS UNIQUEMENT)
// ============================================

let historiqueLoading = false;
let commandes = [];
let selectedCommandes = new Set();
let historiqueInitialized = false;
let historiqueTimeout = null;

// Initialiser la page historique
async function initialiserPageHistorique() {
    console.log('📜 Initialisation page historique...');
    
    // Initialiser le dropdown utilisateur
    initialiserDropdownUtilisateur();
    
    // D'abord, attendre que l'utilisateur soit complètement chargé
    console.log('⏳ Attente du chargement de l\'utilisateur...');
    const estConnecte = await verifierConnexion();
    
    if (!estConnecte) {
        console.log('❌ Utilisateur non connecté, redirection vers connexion');
        window.location.href = 'connexion.html?redirect=historique';
        return;
    }
    
    console.log('✅ Utilisateur connecté, chargement des données...');
    
    // Charger les infos utilisateur et mettre à jour l'interface
    await chargerInfosUtilisateur();
    afficherUtilisateurConnecte();
    
    // Initialiser les événements (sans bloquer)
    initialiserEvenementsHistorique();
    
    // Charger les commandes
    await chargerCommandes();
    
    // Timeout de sécurité (au cas où)
    historiqueTimeout = setTimeout(() => {
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator && !loadingIndicator.classList.contains('d-none')) {
            console.log('⏰ Timeout de chargement');
            if (loadingIndicator) {
                loadingIndicator.innerHTML = `
                    <div class="text-center">
                        <i class="fas fa-exclamation-triangle fa-3x text-danger mb-3"></i>
                        <h4 class="text-danger">Erreur de chargement</h4>
                        <p class="text-muted">Le chargement prend trop de temps. Veuillez réessayer.</p>
                        <button class="btn btn-primary mt-3" onclick="location.reload()">
                            <i class="fas fa-redo me-2"></i>Réessayer
                        </button>
                    </div>
                `;
            }
        }
    }, 15000);
}

// Fonction pour annuler le timeout
function annulerTimeoutHistorique() {
    if (historiqueTimeout) {
        clearTimeout(historiqueTimeout);
        historiqueTimeout = null;
    }
}

// Initialiser les événements
function initialiserEvenementsHistorique() {
    if (!supabase1) return;
    
    // Écouter les changements d'authentification
    supabase1.auth.onAuthStateChange(async (event, session) => {
        console.log('🔄 Auth event historique:', event);
        
        if (event === 'SIGNED_IN' && session) {
            console.log('🎉 Reconnexion détectée, mise à jour...');
            UTILISATEUR_COURANT = session.user.id;
            
            if (!historiqueInitialized) {
                historiqueInitialized = true;
                annulerTimeoutHistorique();
                await chargerInfosUtilisateur();
                afficherUtilisateurConnecte();
                await chargerCommandes();
            }
        } else if (event === 'SIGNED_OUT') {
            console.log('🚪 Déconnexion détectée');
            UTILISATEUR_COURANT = null;
            window.location.href = 'connexion.html?redirect=historique';
        }
    });
}

// Charger les commandes depuis Supabase (UNIQUEMENT LES ACHATS)
async function chargerCommandes() {
    if (!UTILISATEUR_COURANT) {
        console.error('❌ Utilisateur non connecté');
        afficherMessageHistorique('Utilisateur non connecté', 'error');
        return;
    }
    
    if (!supabase1) {
        console.error('❌ Supabase non initialisé');
        afficherMessageHistorique('Erreur de connexion à la base de données', 'error');
        return;
    }

    try {
        console.log('📦 Chargement des commandes pour:', UTILISATEUR_COURANT);

        // Récupérer UNIQUEMENT les commandes où l'utilisateur est acheteur
        const { data: commandesAcheteur, error: errorAcheteur } = await supabase1
            .from('commandes')
            .select(`
                *,
                produit:produits!id_produit(titre, image_url),
                vendeur:utilisateurs!id_vendeur(nom, email, telephone)
            `)
            .eq('id_acheteur', UTILISATEUR_COURANT)
            .order('created_at', { ascending: false });

        if (errorAcheteur) {
            console.error('Erreur chargement commandes acheteur:', errorAcheteur);
        }

        // Utiliser UNIQUEMENT les commandes où l'utilisateur est acheteur
        // (on ne fusionne PAS avec les commandes vendeur)
        commandes = (commandesAcheteur || []).map(cmd => ({ 
            ...cmd, 
            role: 'acheteur',
            autrePartie: cmd.vendeur 
        }));

        console.log(`✅ ${commandes.length} commandes d'achat chargées`);

        // Masquer l'indicateur de chargement
        const loadingIndicator = document.getElementById('loadingIndicator');
        const emptyState = document.getElementById('emptyState');
        const container = document.getElementById('commandesContainer');
        
        if (loadingIndicator) {
            loadingIndicator.classList.add('d-none');
        }

        if (commandes.length === 0) {
            if (emptyState) {
                emptyState.classList.remove('d-none');
                emptyState.innerHTML = `
                    <i class="fas fa-shopping-bag"></i>
                    <h3 class="mb-3">Aucune commande trouvée</h3>
                    <p class="text-muted mb-4">Vous n'avez pas encore passé de commandes.</p>
                    <a href="annonces.html" class="btn btn-primary">
                        <i class="fas fa-store me-2"></i>Découvrir des produits
                    </a>
                `;
            }
            if (container) container.classList.add('d-none');
            console.log('📭 Aucune commande d\'achat trouvée pour cet utilisateur');
        } else {
            if (emptyState) emptyState.classList.add('d-none');
            if (container) {
                container.classList.remove('d-none');
                afficherCommandes();
            }
        }

        // Annuler le timeout car le chargement est terminé
        annulerTimeoutHistorique();

    } catch (error) {
        console.error('❌ Erreur chargement commandes:', error);
        afficherMessageHistorique('Erreur lors du chargement des commandes: ' + error.message, 'error');
        
        const loadingIndicator = document.getElementById('loadingIndicator');
        const emptyState = document.getElementById('emptyState');
        
        if (loadingIndicator) loadingIndicator.classList.add('d-none');
        if (emptyState) {
            emptyState.classList.remove('d-none');
            emptyState.innerHTML = `
                <i class="fas fa-exclamation-triangle text-danger"></i>
                <h3 class="mb-3">Erreur de chargement</h3>
                <p class="text-muted mb-4">${error.message}</p>
                <button class="btn btn-primary mt-2" onclick="location.reload()">
                    <i class="fas fa-redo me-2"></i>Réessayer
                </button>
            `;
        }
        
        annulerTimeoutHistorique();
    }
}

// Vérifier si une commande peut être annulée (moins de 10 minutes)
function peutAnnulerCommande(dateCreation) {
    const maintenant = new Date();
    const creation = new Date(dateCreation);
    const diffMinutes = Math.floor((maintenant - creation) / (1000 * 60));
    return diffMinutes < 10;
}

// Afficher les commandes
function afficherCommandes() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const emptyState = document.getElementById('emptyState');
    const container = document.getElementById('commandesContainer');

    if (loadingIndicator) loadingIndicator.classList.add('d-none');

    if (commandes.length === 0) {
        if (emptyState) emptyState.classList.remove('d-none');
        if (container) container.classList.add('d-none');
        return;
    }

    if (emptyState) emptyState.classList.add('d-none');
    if (container) {
        container.classList.remove('d-none');
        container.innerHTML = '';

        commandes.forEach(commande => {
            const commandeElement = creerElementCommande(commande);
            container.appendChild(commandeElement);
        });
    }
}

// Créer un élément de commande
function creerElementCommande(commande) {
    const id = commande.id;
    const card = document.createElement('div');
    card.className = 'commande-card';
    card.dataset.commandeId = id;

    // Formater la date
    const date = new Date(commande.created_at);
    const dateFormatee = date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Déterminer la classe de l'état
    let etatClass = '';
    let etatIcon = '';
    let etatTexte = commande.etat || 'En attente de livraison';
    
    switch(commande.etat) {
        case 'livrée':
            etatClass = 'etat-livree';
            etatIcon = 'fa-check-circle';
            break;
        case 'annulée':
            etatClass = 'etat-annulee';
            etatIcon = 'fa-times-circle';
            break;
        case 'en cours de livraison':
            etatClass = 'etat-cours';
            etatIcon = 'fa-truck';
            etatTexte = 'En cours de livraison';
            break;
        case 'préparée':
            etatClass = 'etat-livraison';
            etatIcon = 'fa-box';
            etatTexte = 'Préparée';
            break;
        default:
            etatClass = 'etat-livraison';
            etatIcon = 'fa-clock';
            etatTexte = 'En attente de livraison';
    }

    // Récupérer les informations du produit
    const produit = commande.produit || {};
    const imageUrl = produit.image_url || commande.imageUrl || 'image/default-product.jpg';
    const titre = produit.titre || 'Produit inconnu';
    
    // Prix
    const prix = commande.prix || 0;

    // Informations sur le vendeur
    const vendeur = commande.vendeur || {};

    // Vérifier si l'annulation est possible (moins de 10 minutes)
    const peutAnnuler = commande.etat === 'en attente de livraison' && peutAnnulerCommande(commande.created_at);

    // Construction du HTML
    card.innerHTML = `
        <div class="commande-header">
            <div class="d-flex justify-content-between align-items-center w-100">
                <div>
                    <div class="date">
                        <i class="fas fa-calendar-alt me-2"></i>${dateFormatee}
                    </div>
                    <div class="code mt-1">
                        <i class="fas fa-qrcode me-2"></i>${commande.code_unique || 'N/A'}
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <span class="badge bg-light text-dark px-3 py-2 rounded-pill">
                        <i class="fas fa-shopping-bag me-1"></i>Achat
                    </span>
                    <div class="form-check">
                        <input class="form-check-input checkbox-custom" type="checkbox" 
                               id="check-${id}" onchange="toggleSelectionCommande('${id}', this.closest('.commande-card'))">
                    </div>
                </div>
            </div>
            ${peutAnnuler ? `
                <div class="mt-2">
                    <button class="btn btn-warning btn-sm" onclick="annulerCommande('${commande.id}')">
                        <i class="fas fa-times me-1"></i>Annuler (10 min)
                    </button>
                </div>
            ` : ''}
        </div>
        
        <div class="commande-body">
            <!-- Produit -->
            <div class="produit-item">
                <img src="${imageUrl}" 
                     alt="${titre}" 
                     class="produit-image"
                     onerror="this.src='image/default-product.jpg'">
                <div class="produit-info">
                    <div class="produit-nom">${titre}</div>
                    <div class="produit-prix">${prix.toLocaleString()} FCFA</div>
                </div>
            </div>
            
            <!-- Informations sur le vendeur -->
            ${vendeur && vendeur.nom ? `
                <div class="coordonnees">
                    <div class="mb-2">
                        <i class="fas fa-store me-2"></i>
                        <strong>Vendeur:</strong> ${vendeur.nom || 'Non renseigné'}
                    </div>
                    <div class="mb-2">
                        <i class="fas fa-phone me-2"></i>
                        ${vendeur.telephone || 'Téléphone non disponible'}
                    </div>
                </div>
            ` : ''}
            
            <!-- Position de livraison -->
            ${commande.latitude && commande.longitude ? `
                <div class="info-livraison mt-2">
                    <i class="fas fa-map-marker-alt"></i>
                    Position de livraison: ${commande.latitude.toFixed(4)}, ${commande.longitude.toFixed(4)}
                </div>
            ` : ''}
            
            <!-- Téléphone client -->
            ${commande.telephone_client ? `
                <div class="info-livraison mt-1">
                    <i class="fas fa-phone-alt"></i>
                    Téléphone de contact: ${commande.telephone_client}
                </div>
            ` : ''}
            
            <!-- État et total -->
            <div class="info-row">
                <span class="badge-etat ${etatClass}">
                    <i class="fas ${etatIcon} me-1"></i>
                    ${etatTexte}
                </span>
                <span class="total-commande">
                    ${prix.toLocaleString()} FCFA
                </span>
            </div>
            
            <!-- Statut paiement -->
            <div class="mt-2 text-end">
                ${commande.paiement_recu ? 
                    '<span class="text-success"><i class="fas fa-check-circle me-1"></i>Paiement reçu</span>' : 
                    '<span class="text-warning"><i class="fas fa-clock me-1"></i>Paiement en attente</span>'}
            </div>
        </div>
    `;

    return card;
}

// Annuler une commande
async function annulerCommande(commandeId) {
    if (!confirm("Voulez-vous vraiment annuler cette commande ?")) return;
    
    try {
        const { error } = await supabase1
            .from('commandes')
            .update({ etat: 'annulée' })
            .eq('id', commandeId);
            
        if (error) throw error;
        
        alert('✅ Commande annulée avec succès');
        chargerCommandes();
        
    } catch (error) {
        console.error('Erreur annulation:', error);
        alert('❌ Erreur lors de l\'annulation');
    }
}

// Basculer la sélection d'une commande
function toggleSelectionCommande(commandeId, cardElement) {
    if (selectedCommandes.has(commandeId)) {
        selectedCommandes.delete(commandeId);
        cardElement.classList.remove('selected');
        const checkbox = cardElement.querySelector('.checkbox-custom');
        if (checkbox) checkbox.checked = false;
    } else {
        selectedCommandes.add(commandeId);
        cardElement.classList.add('selected');
        const checkbox = cardElement.querySelector('.checkbox-custom');
        if (checkbox) checkbox.checked = true;
    }

    mettreAJourBoutonSuppression();
}

// Mettre à jour le bouton de suppression
function mettreAJourBoutonSuppression() {
    const deleteFab = document.getElementById('deleteFab');
    const selectionCount = document.getElementById('selectionCount');
    const count = selectedCommandes.size;

    if (deleteFab && selectionCount) {
        if (count > 0) {
            deleteFab.classList.remove('d-none');
            selectionCount.textContent = count;
        } else {
            deleteFab.classList.add('d-none');
        }
    }
}

// Supprimer les commandes sélectionnées (RÉACTIVÉ)
async function supprimerCommandes() {
    if (selectedCommandes.size === 0 || !supabase1) return;

    const message = selectedCommandes.size === 1 
        ? 'Voulez-vous vraiment supprimer cette commande ? Cette action est irréversible.'
        : `Voulez-vous vraiment supprimer ces ${selectedCommandes.size} commandes ? Cette action est irréversible.`;

    if (!confirm(message)) return;

    try {
        const { error } = await supabase1
            .from('commandes')
            .delete()
            .in('id', Array.from(selectedCommandes));

        if (error) throw error;

        // Mettre à jour l'affichage
        commandes = commandes.filter(cmd => !selectedCommandes.has(cmd.id));
        selectedCommandes.clear();
        afficherCommandes();
        mettreAJourBoutonSuppression();

        afficherMessageHistorique('✅ Commandes supprimées avec succès', 'success');

    } catch (error) {
        console.error('Erreur suppression commandes:', error);
        afficherMessageHistorique('❌ Erreur lors de la suppression', 'error');
    }
}

// Afficher un message
function afficherMessageHistorique(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show position-fixed`;
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '1050';
    alertDiv.style.minWidth = '300px';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) alertDiv.remove();
    }, 3000);
}*/







// ============================================
// PAGE HISTORIQUE DES COMMANDES - AVEC ANNULATION UNIQUEMENT
// ============================================

let historiqueLoading = false;
let commandes = [];
let historiqueInitialized = false;
let historiqueTimeout = null;

// Initialiser la page historique
async function initialiserPageHistorique() {
    console.log('📜 Initialisation page historique...');
    
    // Initialiser le dropdown utilisateur
    initialiserDropdownUtilisateur();
    
    // D'abord, attendre que l'utilisateur soit complètement chargé
    console.log('⏳ Attente du chargement de l\'utilisateur...');
    const estConnecte = await verifierConnexion();
    
    if (!estConnecte) {
        console.log('❌ Utilisateur non connecté, redirection vers connexion');
        window.location.href = 'connexion.html?redirect=historique';
        return;
    }
    
    console.log('✅ Utilisateur connecté, chargement des données...');
    
    // Charger les infos utilisateur et mettre à jour l'interface
    await chargerInfosUtilisateur();
    afficherUtilisateurConnecte();
    
    // Initialiser les événements
    initialiserEvenementsHistorique();
    
    // Charger les commandes
    await chargerCommandes();
    
    // Timeout de sécurité
    historiqueTimeout = setTimeout(() => {
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator && !loadingIndicator.classList.contains('d-none')) {
            console.log('⏰ Timeout de chargement');
            if (loadingIndicator) {
                loadingIndicator.innerHTML = `
                    <div class="text-center">
                        <i class="fas fa-exclamation-triangle fa-3x text-danger mb-3"></i>
                        <h4 class="text-danger">Erreur de chargement</h4>
                        <p class="text-muted">Le chargement prend trop de temps. Veuillez réessayer.</p>
                        <button class="btn btn-primary mt-3" onclick="location.reload()">
                            <i class="fas fa-redo me-2"></i>Réessayer
                        </button>
                    </div>
                `;
            }
        }
    }, 15000);
}

// Fonction pour annuler le timeout
function annulerTimeoutHistorique() {
    if (historiqueTimeout) {
        clearTimeout(historiqueTimeout);
        historiqueTimeout = null;
    }
}

// Initialiser les événements
function initialiserEvenementsHistorique() {
    if (!supabase1) return;
    
    // Écouter les changements d'authentification
    supabase1.auth.onAuthStateChange(async (event, session) => {
        console.log('🔄 Auth event historique:', event);
        
        if (event === 'SIGNED_IN' && session) {
            console.log('🎉 Reconnexion détectée, mise à jour...');
            UTILISATEUR_COURANT = session.user.id;
            
            if (!historiqueInitialized) {
                historiqueInitialized = true;
                annulerTimeoutHistorique();
                await chargerInfosUtilisateur();
                afficherUtilisateurConnecte();
                await chargerCommandes();
            }
        } else if (event === 'SIGNED_OUT') {
            console.log('🚪 Déconnexion détectée');
            UTILISATEUR_COURANT = null;
            window.location.href = 'connexion.html?redirect=historique';
        }
    });
}

// 🔥 Vérifier si une commande peut être annulée
function peutAnnulerCommande(commande) {
    // Une commande ne peut être annulée que si elle est en "en attente de livraison"
    // et qu'elle n'est pas déjà annulée ou livrée
    return commande.etat === 'en attente de livraison';
}

// 🔥 Obtenir le libellé de l'état
function getEtatLibelle(etat) {
    const etats = {
        'en attente de livraison': 'En attente de livraison',
        'en cours de livraison': 'En cours de livraison',
        'livrée': 'Livrée',
        'annulée': 'Annulée',
        'préparée': 'Préparée'
    };
    return etats[etat] || etat;
}

// Charger les commandes depuis Supabase
async function chargerCommandes() {
    if (!UTILISATEUR_COURANT) {
        console.error('❌ Utilisateur non connecté');
        afficherMessageHistorique('Utilisateur non connecté', 'error');
        return;
    }
    
    if (!supabase1) {
        console.error('❌ Supabase non initialisé');
        afficherMessageHistorique('Erreur de connexion à la base de données', 'error');
        return;
    }

    try {
        console.log('📦 Chargement des commandes pour:', UTILISATEUR_COURANT);

        // Récupérer les commandes où l'utilisateur est acheteur
        const { data: commandesAcheteur, error: errorAcheteur } = await supabase1
            .from('commandes')
            .select(`
                *,
                produit:produits!id_produit(
                    id,
                    titre, 
                    image_url,
                    categorie,
                    prix
                ),
                vendeur:utilisateurs!id_vendeur(
                    id,
                    nom, 
                    email, 
                    telephone
                )
            `)
            .eq('id_acheteur', UTILISATEUR_COURANT)
            .order('created_at', { ascending: false });

        if (errorAcheteur) {
            console.error('Erreur chargement commandes acheteur:', errorAcheteur);
            throw errorAcheteur;
        }

        commandes = (commandesAcheteur || []).map(cmd => ({ 
            ...cmd, 
            role: 'acheteur',
            autrePartie: cmd.vendeur 
        }));

        console.log(`✅ ${commandes.length} commandes d'achat chargées`);

        // Masquer l'indicateur de chargement
        const loadingIndicator = document.getElementById('loadingIndicator');
        const emptyState = document.getElementById('emptyState');
        const container = document.getElementById('commandesContainer');
        
        if (loadingIndicator) {
            loadingIndicator.classList.add('d-none');
        }

        if (commandes.length === 0) {
            if (emptyState) {
                emptyState.classList.remove('d-none');
                emptyState.innerHTML = `
                    <i class="fas fa-shopping-bag fa-4x text-primary mb-3"></i>
                    <h3 class="mb-3">Aucune commande trouvée</h3>
                    <p class="text-muted mb-4">Vous n'avez pas encore passé de commandes.</p>
                    <a href="annonces.html" class="btn btn-primary">
                        <i class="fas fa-store me-2"></i>Découvrir des produits
                    </a>
                `;
            }
            if (container) container.classList.add('d-none');
            console.log('📭 Aucune commande d\'achat trouvée pour cet utilisateur');
        } else {
            if (emptyState) emptyState.classList.add('d-none');
            if (container) {
                container.classList.remove('d-none');
                afficherCommandes();
            }
        }

        // Annuler le timeout car le chargement est terminé
        annulerTimeoutHistorique();

    } catch (error) {
        console.error('❌ Erreur chargement commandes:', error);
        afficherMessageHistorique('Erreur lors du chargement des commandes', 'error');
        
        const loadingIndicator = document.getElementById('loadingIndicator');
        const emptyState = document.getElementById('emptyState');
        
        if (loadingIndicator) loadingIndicator.classList.add('d-none');
        if (emptyState) {
            emptyState.classList.remove('d-none');
            emptyState.innerHTML = `
                <i class="fas fa-exclamation-triangle fa-4x text-danger mb-3"></i>
                <h3 class="mb-3">Erreur de chargement</h3>
                <p class="text-muted mb-4">Impossible de charger vos commandes</p>
                <button class="btn btn-primary mt-2" onclick="location.reload()">
                    <i class="fas fa-redo me-2"></i>Réessayer
                </button>
            `;
        }
        
        annulerTimeoutHistorique();
    }
}

// Afficher les commandes
function afficherCommandes() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const emptyState = document.getElementById('emptyState');
    const container = document.getElementById('commandesContainer');

    if (loadingIndicator) loadingIndicator.classList.add('d-none');

    if (commandes.length === 0) {
        if (emptyState) emptyState.classList.remove('d-none');
        if (container) container.classList.add('d-none');
        return;
    }

    if (emptyState) emptyState.classList.add('d-none');
    if (container) {
        container.classList.remove('d-none');
        container.innerHTML = '';

        commandes.forEach(commande => {
            const commandeElement = creerElementCommande(commande);
            container.appendChild(commandeElement);
        });
    }
}

// 🔥 Créer un élément de commande (version corrigée)
function creerElementCommande(commande) {
    const id = commande.id;
    const card = document.createElement('div');
    card.className = `commande-card ${commande.etat === 'annulée' ? 'border-danger' : ''}`;
    card.dataset.commandeId = id;

    // Formater la date
    const date = new Date(commande.created_at);
    const dateFormatee = date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Déterminer la classe de l'état
    let etatClass = '';
    let etatIcon = '';
    let etatTexte = getEtatLibelle(commande.etat);
    
    switch(commande.etat) {
        case 'livrée':
            etatClass = 'etat-livree';
            etatIcon = 'fa-check-circle';
            break;
        case 'annulée':
            etatClass = 'etat-annulee';
            etatIcon = 'fa-times-circle';
            break;
        case 'en cours de livraison':
            etatClass = 'etat-cours';
            etatIcon = 'fa-truck';
            break;
        case 'préparée':
            etatClass = 'etat-livraison';
            etatIcon = 'fa-box';
            break;
        default:
            etatClass = 'etat-livraison';
            etatIcon = 'fa-clock';
    }

    // Récupérer les informations du produit
    const produit = commande.produit || {};
    const imageUrl = produit.image_url || commande.imageUrl || 'image/default-product.jpg';
    const titre = produit.titre || 'Produit inconnu';
    
    // Prix
    const prix = commande.prix || 0;

    // Informations sur le vendeur
    const vendeur = commande.vendeur || {};

    // 🔥 Vérifier si l'annulation est possible
    const peutAnnuler = peutAnnulerCommande(commande);

    // Construction du HTML
    card.innerHTML = `
        <div class="commande-header">
            <div class="d-flex justify-content-between align-items-center w-100">
                <div>
                    <div class="date">
                        <i class="fas fa-calendar-alt me-2"></i>${dateFormatee}
                    </div>
                    <div class="code mt-1">
                        <i class="fas fa-qrcode me-2"></i>${commande.code_unique || 'N/A'}
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <span class="badge bg-light text-dark px-3 py-2 rounded-pill">
                        <i class="fas fa-shopping-bag me-1"></i>Achat
                    </span>
                </div>
            </div>
        </div>
        
        <div class="commande-body">
            <!-- Produit -->
            <div class="produit-item">
                <img src="${imageUrl}" 
                     alt="${titre}" 
                     class="produit-image"
                     onerror="this.src='image/default-product.jpg'">
                <div class="produit-info">
                    <div class="produit-nom">${titre}</div>
                    <div class="produit-prix">${prix.toLocaleString()} FCFA</div>
                    ${produit.categorie ? `
                        <div class="small text-muted">
                            <i class="fas fa-tag me-1"></i>${produit.categorie}
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <!-- Informations sur le vendeur -->
            ${vendeur && vendeur.nom ? `
                <div class="coordonnees">
                    <div class="mb-2">
                        <i class="fas fa-store me-2"></i>
                        <strong>Vendeur:</strong> ${vendeur.nom || 'Non renseigné'}
                    </div>
                    ${vendeur.telephone ? `
                        <div class="mb-2">
                            <i class="fas fa-phone me-2"></i>
                            ${vendeur.telephone}
                        </div>
                    ` : ''}
                </div>
            ` : ''}
            
            <!-- Position de livraison -->
            ${commande.latitude && commande.longitude ? `
                <div class="info-livraison mt-2">
                    <i class="fas fa-map-marker-alt text-primary"></i>
                    Position de livraison: ${commande.latitude.toFixed(4)}, ${commande.longitude.toFixed(4)}
                </div>
            ` : ''}
            
            <!-- État et total -->
            <div class="info-row">
                <span class="badge-etat ${etatClass}">
                    <i class="fas ${etatIcon} me-1"></i>
                    ${etatTexte}
                </span>
                <span class="total-commande">
                    ${prix.toLocaleString()} FCFA
                </span>
            </div>
            
            
            <!-- 🔥 Bouton d'annulation (seulement si possible) -->
            ${peutAnnuler ? `
                <div class="mt-3 text-end">
                    <button class="btn btn-warning" onclick="annulerCommande('${commande.id}')">
                        <i class="fas fa-times me-2"></i>Annuler la commande
                    </button>

                </div>
            ` : commande.etat === 'annulée' ? `
                <div class="mt-3 text-end">
                    <span class="text-danger">
                        <i class="fas fa-ban me-1"></i>
                        Commande annulée
                    </span>
                </div>
            ` : ''}
        </div>
    `;

    return card;
}

// 🔥 Annuler une commande
async function annulerCommande(commandeId) {
    if (!confirm("⚠️ Êtes-vous sûr de vouloir annuler cette commande ? Cette action est irréversible.")) {
        return;
    }
    
    try {
        // Récupérer la commande pour vérifier son état
        const { data: commande, error: fetchError } = await supabase1
            .from('commandes')
            .select('etat')
            .eq('id', commandeId)
            .single();
            
        if (fetchError) throw fetchError;
        
        // Vérifier que la commande peut encore être annulée
        if (!peutAnnulerCommande(commande)) {
            alert('❌ Cette commande ne peut plus être annulée car elle a déjà un statut différent.');
            chargerCommandes(); // Recharger pour mettre à jour
            return;
        }
        
        // Mettre à jour l'état de la commande
        const { error } = await supabase1
            .from('commandes')
            .update({ 
                etat: 'annulée',
            })
            .eq('id', commandeId);
            
        if (error) throw error;
        
        // Afficher un message de succès
        afficherMessageHistorique('✅ Commande annulée avec succès', 'success');
        
        // Recharger les commandes pour mettre à jour l'affichage
        await chargerCommandes();
        
    } catch (error) {
        console.error('Erreur annulation:', error);
        afficherMessageHistorique('❌ Erreur lors de l\'annulation', 'error');
    }
}

// Afficher un message
function afficherMessageHistorique(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show position-fixed`;
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '1050';
    alertDiv.style.minWidth = '300px';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) alertDiv.remove();
    }, 3000);
}


// Basculer la sélection d'une commande
function toggleSelectionCommande(commandeId, cardElement) {
    if (selectedCommandes.has(commandeId)) {
        selectedCommandes.delete(commandeId);
        cardElement.classList.remove('selected');
        const checkbox = cardElement.querySelector('.checkbox-custom');
        if (checkbox) checkbox.checked = false;
    } else {
        selectedCommandes.add(commandeId);
        cardElement.classList.add('selected');
        const checkbox = cardElement.querySelector('.checkbox-custom');
        if (checkbox) checkbox.checked = true;
    }

    mettreAJourBoutonSuppression();
}


/*// ============================================
// PAGE ANNONCES - FILTRES ET RECHERCHE
// ============================================

let annoncesLoading = false;
let produitsListe = [];
let categoriesListe = [];
let filtreActuel = 'toutes';
let rechercheActuelle = '';
let pageActuelle = 1;
const produitsParPage = 12;

// Initialiser la page annonces
function initialiserPageAnnonces() {
    console.log('📋 Initialisation page annonces...');
    
    initialiserEvenementsAnnonces();
    verifierConnexionAnnonces();
    
    // Timeout de sécurité
    setTimeout(() => {
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator && !loadingIndicator.classList.contains('d-none')) {
            console.log('⏰ Timeout de chargement');
            afficherErreurChargementAnnonces();
        }
    }, 10000);
}

// Initialiser les événements
function initialiserEvenementsAnnonces() {
    // Recherche
    const searchButton = document.getElementById('searchButton');
    const searchInput = document.getElementById('searchInput');
    
    if (searchButton) {
        searchButton.addEventListener('click', () => {
            rechercheActuelle = searchInput.value.trim();
            pageActuelle = 1;
            chargerProduitsAnnonces();
        });
    }
    
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                rechercheActuelle = searchInput.value.trim();
                pageActuelle = 1;
                chargerProduitsAnnonces();
            }
        });
    }
}

// Vérifier la connexion
async function verifierConnexionAnnonces() {
    // Attendre l'auth sans bloquer l'affichage
    await attendreUtilisateur();
    
    try {
        const { data: { session }, error } = await supabase1.auth.getSession();
        
        if (error) throw error;
        
        if (session && session.user) {
            UTILISATEUR_COURANT = session.user.id;
            await chargerInfosUtilisateur();
            afficherUtilisateurConnecte();
        }
        
        // Charger les produits (connecté ou non)
        await chargerCategoriesAnnonces();
        await chargerProduitsAnnonces();
        
    } catch (error) {
        console.error('Erreur vérification connexion:', error);
        // Continuer sans utilisateur connecté
        await chargerCategoriesAnnonces();
        await chargerProduitsAnnonces();
    }
}

// Charger les catégories disponibles
async function chargerCategoriesAnnonces() {
    if (!supabase1) return;
    
    try {
        const { data, error } = await supabase1
            .from('produits')
            .select('categorie')
            .order('categorie');

        if (error) throw error;

        // Extraire les catégories uniques
        const categoriesSet = new Set();
        data.forEach(item => {
            if (item.categorie) {
                categoriesSet.add(item.categorie);
            }
        });

        categoriesListe = Array.from(categoriesSet).sort();

        // Afficher les catégories
        afficherCategoriesAnnonces();

    } catch (error) {
        console.error('Erreur chargement catégories:', error);
    }
}

// Afficher les catégories
function afficherCategoriesAnnonces() {
    const container = document.getElementById('categoriesContainer');
    if (!container) return;

    // Vider le container
    container.innerHTML = '';

    // Créer le bouton "Toutes"
    const toutesBtn = document.createElement('div');
    toutesBtn.className = `categorie-badge ${filtreActuel === 'toutes' ? 'active' : ''}`;
    toutesBtn.dataset.categorie = 'toutes';
    toutesBtn.innerHTML = `
        <i class="fas fa-th-large"></i>
        Toutes
    `;
    
    // Ajouter l'événement au bouton "Toutes"
    toutesBtn.addEventListener('click', () => {
        // Mettre à jour l'affichage
        document.querySelectorAll('.categorie-badge').forEach(b => 
            b.classList.remove('active')
        );
        toutesBtn.classList.add('active');
        
        // Appliquer le filtre
        filtreActuel = 'toutes';
        pageActuelle = 1;
        chargerProduitsAnnonces();
    });
    
    container.appendChild(toutesBtn);

    // Ajouter les catégories
    categoriesListe.forEach(categorie => {
        const btn = document.createElement('div');
        btn.className = `categorie-badge ${filtreActuel === categorie ? 'active' : ''}`;
        btn.dataset.categorie = categorie;
        btn.innerHTML = `
            <i class="fas fa-tag"></i>
            ${categorie}
        `;
        
        btn.addEventListener('click', () => {
            // Mettre à jour l'affichage
            document.querySelectorAll('.categorie-badge').forEach(b => 
                b.classList.remove('active')
            );
            btn.classList.add('active');
            
            // Appliquer le filtre
            filtreActuel = categorie;
            pageActuelle = 1;
            chargerProduitsAnnonces();
        });
        
        container.appendChild(btn);
    });

    // Mettre à jour les statistiques
    const totalCategories = document.getElementById('totalCategories');
    if (totalCategories) totalCategories.textContent = categoriesListe.length + 1;
}

// Charger les produits avec filtres
async function chargerProduitsAnnonces() {
    annoncesLoading = true;
    
    const loadingIndicator = document.getElementById('loadingIndicator');
    const produitsContainer = document.getElementById('produitsContainer');
    const emptyState = document.getElementById('emptyState');

    if (loadingIndicator) loadingIndicator.classList.remove('d-none');
    if (produitsContainer) produitsContainer.classList.add('d-none');
    if (emptyState) emptyState.classList.add('d-none');

    if (!supabase1) return;

    try {
        let query = supabase1
            .from('produits')
            .select(`
                *,
                vendeur:utilisateurs!vendeur_id(nom, telephone, email, avatar, note_moyenne)
            `, { count: 'exact' });

        // Appliquer le filtre par catégorie
        if (filtreActuel !== 'toutes') {
            query = query.eq('categorie', filtreActuel);
        }

        // Appliquer la recherche
        if (rechercheActuelle) {
            query = query.or(`
                titre.ilike.%${rechercheActuelle}%,
                description.ilike.%${rechercheActuelle}%,
                categorie.ilike.%${rechercheActuelle}%
            `);
        }

        // Trier par date de création
        query = query.order('created_at', { ascending: false });

        // Appliquer la pagination
        const from = (pageActuelle - 1) * produitsParPage;
        const to = from + produitsParPage - 1;
        
        const { data, error, count } = await query.range(from, to);

        if (error) throw error;

        produitsListe = data || [];
        const totalProduits = count || 0;

        console.log(`📦 ${produitsListe.length} produits chargés sur ${totalProduits} total`);

        // Mettre à jour les statistiques
        const totalProduitsElement = document.getElementById('totalProduits');
        if (totalProduitsElement) totalProduitsElement.textContent = totalProduits;

        if (produitsListe.length === 0) {
            afficherEtatVideAnnonces();
        } else {
            afficherProduitsAnnonces();
            afficherPaginationAnnonces(totalProduits);
        }

    } catch (error) {
        console.error('❌ Erreur chargement produits:', error);
        afficherErreurChargementAnnonces();
    } finally {
        annoncesLoading = false;
        if (loadingIndicator) loadingIndicator.classList.add('d-none');
    }
}

// Afficher les produits
function afficherProduitsAnnonces() {
    const produitsContainer = document.getElementById('produitsContainer');
    const produitsGrid = document.getElementById('produitsGrid');
    
    if (!produitsContainer || !produitsGrid) return;
    
    produitsContainer.classList.remove('d-none');
    produitsGrid.innerHTML = '';

    produitsListe.forEach(produit => {
        const card = creerCarteProduitAnnonces(produit);
        produitsGrid.appendChild(card);
    });
}

// Créer une carte produit
function creerCarteProduitAnnonces(produit) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4 col-xl-3';

    const vendeur = produit.vendeur || {};
    const initiales = vendeur.nom ? 
        vendeur.nom.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 
        'V';

    col.innerHTML = `
        <div class="produit-card" onclick="window.location.href='detail-annonce.html?id=${produit.id}'" style="cursor: pointer;">
            <img src="${produit.image_url || 'image/default-product.jpg'}" 
                 alt="${produit.titre || 'Produit'}" 
                 class="produit-image"
                 onerror="this.src='image/default-product.jpg'">
            <div class="produit-contenu">
                <div class="produit-categorie">
                    <i class="fas fa-tag me-1"></i>
                    ${produit.categorie || 'Non catégorisé'}
                </div>
                <h3 class="produit-titre">${produit.titre || 'Sans titre'}</h3>
                <p class="produit-description">${produit.description || 'Aucune description'}</p>
                <div class="produit-prix">${produit.prix ? produit.prix.toLocaleString() + ' FCFA' : 'Prix non disponible'}</div>
            </div>
            <div class="produit-footer">
                <div class="produit-vendeur">
                    <div class="vendeur-avatar">${initiales}</div>
                    <span class="vendeur-nom">${vendeur.nom || 'Vendeur'}</span>
                </div>
            </div>
        </div>
    `;

    return col;
}

// Afficher l'état vide
function afficherEtatVideAnnonces() {
    const produitsContainer = document.getElementById('produitsContainer');
    const emptyState = document.getElementById('emptyState');
    const emptyMessage = document.getElementById('emptyStateMessage');

    if (produitsContainer) produitsContainer.classList.add('d-none');
    if (emptyState) emptyState.classList.remove('d-none');

    if (emptyMessage) {
        if (rechercheActuelle) {
            emptyMessage.textContent = `Aucun produit ne correspond à "${rechercheActuelle}"`;
        } else if (filtreActuel !== 'toutes') {
            emptyMessage.textContent = `Aucun produit dans la catégorie "${filtreActuel}"`;
        } else {
            emptyMessage.textContent = 'Aucun produit disponible pour le moment';
        }
    }
}

// Afficher la pagination
function afficherPaginationAnnonces(total) {
    const totalPages = Math.ceil(total / produitsParPage);
    const paginationContainer = document.getElementById('paginationContainer');
    const pagination = document.getElementById('pagination');
    
    if (!paginationContainer || !pagination) return;
    
    if (totalPages <= 1) {
        paginationContainer.classList.add('d-none');
        return;
    }

    paginationContainer.classList.remove('d-none');
    pagination.innerHTML = '';

    // Bouton précédent
    pagination.innerHTML += `
        <li class="page-item ${pageActuelle === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changerPageAnnonces(${pageActuelle - 1}); return false;">
                <i class="fas fa-chevron-left"></i>
            </a>
        </li>
    `;

    // Pages
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= pageActuelle - 2 && i <= pageActuelle + 2)) {
            pagination.innerHTML += `
                <li class="page-item ${i === pageActuelle ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="changerPageAnnonces(${i}); return false;">${i}</a>
                </li>
            `;
        } else if (i === pageActuelle - 3 || i === pageActuelle + 3) {
            pagination.innerHTML += `
                <li class="page-item disabled">
                    <span class="page-link">...</span>
                </li>
            `;
        }
    }

    // Bouton suivant
    pagination.innerHTML += `
        <li class="page-item ${pageActuelle === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changerPageAnnonces(${pageActuelle + 1}); return false;">
                <i class="fas fa-chevron-right"></i>
            </a>
        </li>
    `;
}

// Changer de page
function changerPageAnnonces(page) {
    pageActuelle = page;
    chargerProduitsAnnonces();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Réinitialiser les filtres
function resetFiltresAnnonces() {
    filtreActuel = 'toutes';
    rechercheActuelle = '';
    pageActuelle = 1;
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    
    // Recharger les catégories pour réinitialiser l'affichage
    chargerCategoriesAnnonces();
    chargerProduitsAnnonces();
}

// Afficher une erreur de chargement
function afficherErreurChargementAnnonces() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.innerHTML = `
            <div class="text-center">
                <i class="fas fa-exclamation-triangle fa-3x text-danger mb-3"></i>
                <h4 class="text-danger">Erreur de chargement</h4>
                <p class="text-muted">Impossible de charger les annonces</p>
                <button class="btn btn-primary mt-3" onclick="location.reload()">
                    <i class="fas fa-redo me-2"></i>Réessayer
                </button>
            </div>
        `;
    }
}

// Afficher un message
function afficherMessageAnnonces(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show position-fixed`;
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '1050';
    alertDiv.style.minWidth = '300px';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) alertDiv.remove();
    }, 3000);
}*/







// ============================================
// PAGE ANNONCES - FILTRES ET RECHERCHE PERFORMANTE
// ============================================

let annoncesLoading = false;
let produitsListe = [];
let categoriesListe = [];
let filtreActuel = 'toutes';
let rechercheActuelle = '';
let pageActuelle = 1;
const produitsParPage = 12;

// 🔥 Dictionnaire de synonymes intelligent
const DICTIONNAIRE_SYNONYMES = {
    // Véhicules
    'voiture': ['voiture', 'véhicule', 'auto', 'automobile', '4x4', 'berline', 'citadine', 'suv'],
    'moto': ['moto', 'motocyclette', 'scooter', 'cyclomoteur', 'vespa', 'motard'],
    'velo': ['vélo', 'bicyclette', 'cycle', 'vtt', 'vélo de route', 'cyclisme'],
    
    // Électronique
    'telephone': ['téléphone', 'smartphone', 'mobile', 'iphone', 'samsung', 'huawei', 'xiaomi', 'téléphonie'],
    'ordinateur': ['ordinateur', 'pc', 'laptop', 'portable', 'mac', 'imac', 'macbook', 'ordinateur portable'],
    'tablette': ['tablette', 'ipad', 'samsung tab', 'android tablet'],
    'tv': ['tv', 'télévision', 'écran', 'téléviseur', 'led', 'lcd', 'oled', 'smart tv'],
    'appareil photo': ['appareil photo', 'camera', 'canon', 'nikon', 'sony', 'reflex', 'hybride'],
    
    // Mode
    'vetement': ['vêtement', 'habit', 'tenue', 'fringue', 'chemise', 'pantalon', 'robe', 'jupe', 'costume'],
    'chaussure': ['chaussure', 'soulier', 'basket', 'tennis', 'botte', 'sandale', 'escarpin'],
    'sac': ['sac', 'sac à main', 'sacoche', 'cartable', 'besace', 'maroquinerie'],
    
    // Maison
    'meuble': ['meuble', 'mobilier', 'table', 'chaise', 'armoire', 'canapé', 'lit', 'bureau'],
    'electromenager': ['électroménager', 'frigo', 'réfrigérateur', 'cuisinière', 'four', 'micro-ondes', 'lave-linge'],
    'decoration': ['décoration', 'déco', 'accessoire', 'cadre', 'lampe', 'miroir', 'tapis'],
    
    // Loisirs
    'jeu': ['jeu', 'jeux', 'console', 'playstation', 'xbox', 'nintendo', 'switch', 'ps5', 'ps4'],
    'livre': ['livre', 'roman', 'manuel', 'bd', 'bande dessinée', 'manga', 'encyclopédie'],
    'sport': ['sport', 'équipement sportif', 'musculation', 'fitness', 'vélo', 'football', 'basket'],
    
    // Bricolage
    'outil': ['outil', 'bricolage', 'perceuse', 'marteau', 'tournevis', 'scie', 'établi'],
    
    // Puériculture
    'bebe': ['bébé', 'puériculture', 'poussette', 'lit bébé', 'chaise haute', 'baby', 'enfant']
};

// 🔥 Cache des termes de recherche pour éviter les recalculs
const cacheRecherche = new Map();

// Initialiser la page annonces
function initialiserPageAnnonces() {
    console.log('📋 Initialisation page annonces...');
    
    initialiserEvenementsAnnonces();
    initialiserRechercheTempsReel();
    verifierConnexionAnnonces();
    
    // Timeout de sécurité
    setTimeout(() => {
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator && !loadingIndicator.classList.contains('d-none')) {
            console.log('⏰ Timeout de chargement');
            afficherErreurChargementAnnonces();
        }
    }, 10000);
}

// 🔥 Initialiser la recherche en temps réel
function initialiserRechercheTempsReel() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    let timeoutId = null;

    searchInput.addEventListener('input', (e) => {
        // Debounce : attendre que l'utilisateur arrête de taper
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            const valeur = e.target.value.trim();
            if (valeur.length >= 2 || valeur.length === 0) {
                console.log('🔍 Recherche en temps réel:', valeur);
                rechercheActuelle = valeur;
                pageActuelle = 1;
                chargerProduitsAnnonces();
            }
        }, 300); // 300ms de délai
    });
}

// Initialiser les événements
function initialiserEvenementsAnnonces() {
    // Recherche
    const searchButton = document.getElementById('searchButton');
    const searchInput = document.getElementById('searchInput');
    
    if (searchButton) {
        searchButton.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('🔍 Recherche cliquée');
            rechercheActuelle = searchInput.value.trim();
            pageActuelle = 1;
            chargerProduitsAnnonces();
        });
    }
    
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                console.log('🔍 Recherche par entrée');
                rechercheActuelle = searchInput.value.trim();
                pageActuelle = 1;
                chargerProduitsAnnonces();
            }
        });
    }

    // Filtres par catégorie
    const filterButtons = document.querySelectorAll('.filter-btn, .categorie-badge');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const filtre = btn.dataset.filter || btn.dataset.categorie;
            if (filtre) {
                filtreActuel = filtre;
                pageActuelle = 1;
                chargerProduitsAnnonces();
            }
        });
    });
}

// 🔥 Générer les termes de recherche étendus
function genererTermesRecherche(terme) {
    if (!terme || terme.length < 2) return [terme];
    
    // Vérifier le cache
    if (cacheRecherche.has(terme)) {
        return cacheRecherche.get(terme);
    }
    
    const termeLower = terme.toLowerCase();
    let termes = [termeLower];
    
    // Ajouter les synonymes
    for (const [motCle, synonymes] of Object.entries(DICTIONNAIRE_SYNONYMES)) {
        if (termeLower.includes(motCle) || motCle.includes(termeLower)) {
            termes = [...termes, ...synonymes];
            break;
        }
        
        // Vérifier si le terme correspond à un synonyme
        for (const synonyme of synonymes) {
            if (termeLower.includes(synonyme) || synonyme.includes(termeLower)) {
                termes = [...termes, motCle, ...synonymes];
                break;
            }
        }
    }
    
    // Déduplication
    termes = [...new Set(termes)];
    
    // Ajouter des variations (stemming simple)
    const variations = [];
    termes.forEach(t => {
        variations.push(t); // terme original
        variations.push(t + 's'); // pluriel
        variations.push(t + 'e'); // féminin
        variations.push(t + 'es'); // féminin pluriel
        variations.push(t.replace(/s$/, '')); // sans s final
        variations.push(t.replace(/e$/, '')); // sans e final
    });
    
    // Nettoyer et dédupliquer
    termes = [...new Set(variations.filter(t => t && t.length > 1))];
    
    // Mettre en cache
    cacheRecherche.set(terme, termes);
    
    console.log(`🔍 Termes étendus pour "${terme}":`, termes);
    return termes;
}

// 🔥 Construire la requête de recherche intelligente
function construireRequeteRecherche(query, recherche) {
    if (!recherche || recherche.trim() === '') return query;
    
    const termes = genererTermesRecherche(recherche);
    
    // Construire une requête OR complexe
    let conditions = [];
    
    termes.forEach(terme => {
        // Recherche dans titre, description et catégorie
        conditions.push(`titre.ilike.%${terme}%`);
        conditions.push(`description.ilike.%${terme}%`);
        conditions.push(`categorie.ilike.%${terme}%`);
        
        // Recherche dans les mots-clés si le champ existe
        // conditions.push(`mots_cles.cs.{${terme}}`); // Si vous avez un tableau de mots-clés
    });
    
    // Supprimer les doublons
    conditions = [...new Set(conditions)];
    
    // Appliquer la condition OR
    if (conditions.length > 0) {
        query = query.or(conditions.join(','));
    }
    
    return query;
}

// Vérifier la connexion
async function verifierConnexionAnnonces() {
    await attendreUtilisateur();
    
    try {
        const { data: { session }, error } = await supabase1.auth.getSession();
        
        if (error) throw error;
        
        if (session && session.user) {
            UTILISATEUR_COURANT = session.user.id;
            await chargerInfosUtilisateur();
            afficherUtilisateurConnecte();
        }
        
        await chargerCategoriesAnnonces();
        await chargerProduitsAnnonces();
        
    } catch (error) {
        console.error('Erreur vérification connexion:', error);
        await chargerCategoriesAnnonces();
        await chargerProduitsAnnonces();
    }
}

// Charger les catégories disponibles
async function chargerCategoriesAnnonces() {
    if (!supabase1) return;
    
    try {
        const { data, error } = await supabase1
            .from('produits')
            .select('categorie')
            .order('categorie');

        if (error) throw error;

        const categoriesSet = new Set();
        data.forEach(item => {
            if (item.categorie) {
                categoriesSet.add(item.categorie);
            }
        });

        categoriesListe = Array.from(categoriesSet).sort();
        afficherCategoriesAnnonces();

    } catch (error) {
        console.error('Erreur chargement catégories:', error);
    }
}

// Afficher les catégories
function afficherCategoriesAnnonces() {
    const container = document.getElementById('categoriesContainer');
    if (!container) return;

    container.innerHTML = '';

    const toutesBtn = document.createElement('div');
    toutesBtn.className = `categorie-badge ${filtreActuel === 'toutes' ? 'active' : ''}`;
    toutesBtn.dataset.categorie = 'toutes';
    toutesBtn.innerHTML = `
        <i class="fas fa-th-large"></i>
        Toutes
    `;
    
    toutesBtn.addEventListener('click', () => {
        document.querySelectorAll('.categorie-badge').forEach(b => 
            b.classList.remove('active')
        );
        toutesBtn.classList.add('active');
        filtreActuel = 'toutes';
        pageActuelle = 1;
        chargerProduitsAnnonces();
    });
    
    container.appendChild(toutesBtn);

    categoriesListe.forEach(categorie => {
        const btn = document.createElement('div');
        btn.className = `categorie-badge ${filtreActuel === categorie ? 'active' : ''}`;
        btn.dataset.categorie = categorie;
        btn.innerHTML = `
            <i class="fas fa-tag"></i>
            ${categorie}
        `;
        
        btn.addEventListener('click', () => {
            document.querySelectorAll('.categorie-badge').forEach(b => 
                b.classList.remove('active')
            );
            btn.classList.add('active');
            filtreActuel = categorie;
            pageActuelle = 1;
            chargerProduitsAnnonces();
        });
        
        container.appendChild(btn);
    });

    const totalCategories = document.getElementById('totalCategories');
    if (totalCategories) totalCategories.textContent = categoriesListe.length + 1;
}

// 🔥 Charger les produits avec recherche intelligente
async function chargerProduitsAnnonces() {
    if (annoncesLoading) {
        console.log('⏳ Chargement déjà en cours...');
        return;
    }
    
    annoncesLoading = true;
    
    const loadingIndicator = document.getElementById('loadingIndicator');
    const produitsContainer = document.getElementById('produitsContainer');
    const emptyState = document.getElementById('emptyState');

    if (loadingIndicator) loadingIndicator.classList.remove('d-none');
    if (produitsContainer) produitsContainer.classList.add('d-none');
    if (emptyState) emptyState.classList.add('d-none');

    if (!supabase1) {
        console.error('❌ Supabase non initialisé');
        annoncesLoading = false;
        return;
    }

    try {
        console.log(`📦 Chargement produits - Filtre: ${filtreActuel}, Recherche: "${rechercheActuelle}"`);
        
        let query = supabase1
            .from('produits')
            .select(`
                *,
                vendeur:utilisateurs!vendeur_id(
                    nom, 
                    telephone, 
                    email, 
                    avatar, 
                    note_moyenne
                )
            `, { count: 'exact' });

        // Appliquer le filtre par catégorie
        if (filtreActuel && filtreActuel !== 'toutes') {
            query = query.eq('categorie', filtreActuel);
        }

        // 🔥 Appliquer la recherche intelligente
        if (rechercheActuelle && rechercheActuelle.trim() !== '') {
            query = construireRequeteRecherche(query, rechercheActuelle);
        }

        // Trier par pertinence et date
        query = query.order('created_at', { ascending: false });

        // Appliquer la pagination
        const from = (pageActuelle - 1) * produitsParPage;
        const to = from + produitsParPage - 1;
        
        console.log('🔍 Exécution de la requête...');
        const { data, error, count } = await query.range(from, to);

        if (error) {
            console.error('❌ Erreur Supabase:', error);
            throw error;
        }

        produitsListe = data || [];
        const totalProduits = count || 0;

        console.log(`📦 ${produitsListe.length} produits chargés sur ${totalProduits} total`);

        const totalProduitsElement = document.getElementById('totalProduits');
        if (totalProduitsElement) totalProduitsElement.textContent = totalProduits;

        if (produitsListe.length === 0) {
            afficherEtatVideAnnonces();
        } else {
            afficherProduitsAnnonces();
            afficherPaginationAnnonces(totalProduits);
        }

    } catch (error) {
        console.error('❌ Erreur chargement produits:', error);
        afficherErreurChargementAnnonces(error.message);
    } finally {
        annoncesLoading = false;
        if (loadingIndicator) loadingIndicator.classList.add('d-none');
    }
}

// Afficher les produits
function afficherProduitsAnnonces() {
    const produitsContainer = document.getElementById('produitsContainer');
    const produitsGrid = document.getElementById('produitsGrid');
    
    if (!produitsContainer || !produitsGrid) return;
    
    produitsContainer.classList.remove('d-none');
    produitsGrid.innerHTML = '';

    produitsListe.forEach(produit => {
        const card = creerCarteProduitAnnonces(produit);
        produitsGrid.appendChild(card);
    });
}

// Créer une carte produit
function creerCarteProduitAnnonces(produit) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4 col-xl-3';

    const vendeur = produit.vendeur || {};
    const initiales = vendeur.nom ? 
        vendeur.nom.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 
        'V';

    col.innerHTML = `
        <div class="produit-card" onclick="window.location.href='detail-annonce.html?id=${produit.id}'" style="cursor: pointer;">
            <img src="${produit.image_url || 'image/default-product.jpg'}" 
                 alt="${produit.titre || 'Produit'}" 
                 class="produit-image"
                 loading="lazy"
                 onerror="this.src='image/default-product.jpg'">
            <div class="produit-contenu">
                <div class="produit-categorie">
                    <i class="fas fa-tag me-1"></i>
                    ${produit.categorie || 'Non catégorisé'}
                </div>
                <h3 class="produit-titre">${produit.titre || 'Sans titre'}</h3>
                <p class="produit-description">${(produit.description || '').substring(0, 100)}${produit.description && produit.description.length > 100 ? '...' : ''}</p>
                <div class="produit-prix">${produit.prix ? produit.prix.toLocaleString() + ' FCFA' : 'Prix non disponible'}</div>
            </div>
            <div class="produit-footer">
                <div class="produit-vendeur">
                    <div class="vendeur-avatar">${initiales}</div>
                    <span class="vendeur-nom">${vendeur.nom || 'Vendeur'}</span>
                </div>
            </div>
        </div>
    `;

    return col;
}

// Afficher l'état vide
function afficherEtatVideAnnonces() {
    const produitsContainer = document.getElementById('produitsContainer');
    const emptyState = document.getElementById('emptyState');
    const emptyMessage = document.getElementById('emptyStateMessage');
    const emptySuggestion = document.getElementById('emptyStateSuggestion');

    if (produitsContainer) produitsContainer.classList.add('d-none');
    if (emptyState) emptyState.classList.remove('d-none');

    if (emptyMessage) {
        if (rechercheActuelle) {
            emptyMessage.textContent = `Aucun produit ne correspond à "${rechercheActuelle}"`;
            if (emptySuggestion) {
                emptySuggestion.innerHTML = `
                    Suggestions :
                    <ul class="mt-2">
                        <li>Vérifiez l'orthographe</li>
                        <li>Utilisez des termes plus génériques</li>
                        <li>Essayez "voiture" au lieu de "4x4"</li>
                    </ul>
                `;
            }
        } else if (filtreActuel !== 'toutes') {
            emptyMessage.textContent = `Aucun produit dans la catégorie "${filtreActuel}"`;
        } else {
            emptyMessage.textContent = 'Aucun produit disponible pour le moment';
        }
    }
}

// Afficher la pagination
function afficherPaginationAnnonces(total) {
    const totalPages = Math.ceil(total / produitsParPage);
    const paginationContainer = document.getElementById('paginationContainer');
    const pagination = document.getElementById('pagination');
    
    if (!paginationContainer || !pagination) return;
    
    if (totalPages <= 1) {
        paginationContainer.classList.add('d-none');
        return;
    }

    paginationContainer.classList.remove('d-none');
    pagination.innerHTML = '';

    pagination.innerHTML += `
        <li class="page-item ${pageActuelle === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changerPageAnnonces(${pageActuelle - 1}); return false;">
                <i class="fas fa-chevron-left"></i>
            </a>
        </li>
    `;

    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= pageActuelle - 2 && i <= pageActuelle + 2)) {
            pagination.innerHTML += `
                <li class="page-item ${i === pageActuelle ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="changerPageAnnonces(${i}); return false;">${i}</a>
                </li>
            `;
        } else if (i === pageActuelle - 3 || i === pageActuelle + 3) {
            pagination.innerHTML += `
                <li class="page-item disabled">
                    <span class="page-link">...</span>
                </li>
            `;
        }
    }

    pagination.innerHTML += `
        <li class="page-item ${pageActuelle === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changerPageAnnonces(${pageActuelle + 1}); return false;">
                <i class="fas fa-chevron-right"></i>
            </a>
        </li>
    `;
}

function changerPageAnnonces(page) {
    pageActuelle = page;
    chargerProduitsAnnonces();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetFiltresAnnonces() {
    filtreActuel = 'toutes';
    rechercheActuelle = '';
    pageActuelle = 1;
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    
    chargerCategoriesAnnonces();
    chargerProduitsAnnonces();
}

function afficherErreurChargementAnnonces(message) {
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.innerHTML = `
            <div class="text-center">
                <i class="fas fa-exclamation-triangle fa-3x text-danger mb-3"></i>
                <h4 class="text-danger">Erreur de chargement</h4>
                <p class="text-muted">${message || 'Impossible de charger les annonces'}</p>
                <button class="btn btn-primary mt-3" onclick="location.reload()">
                    <i class="fas fa-redo me-2"></i>Réessayer
                </button>
            </div>
        `;
    }
}

function afficherMessageAnnonces(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show position-fixed`;
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '1050';
    alertDiv.style.minWidth = '300px';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) alertDiv.remove();
    }, 3000);
}
























// ============================================
// DÉTECTION AUTOMATIQUE DE LA PAGE
// ============================================

// Détecter la page actuelle et initialiser les fonctions appropriées
document.addEventListener('DOMContentLoaded', function() {
    const path = window.location.pathname;
    const filename = path.split('/').pop() || 'home.html';
    
    console.log('📄 Page détectée:', filename);
    
    if (filename === 'connexion.html' || path.includes('connexion') || filename.includes('connexion')) {
        // Page de connexion
        if (typeof initialiserPageConnexion === 'function') {
            initialiserPageConnexion();
        }
    } 
    else if (filename === 'inscription.html' || path.includes('inscription') || filename.includes('inscription')) {
        // Page d'inscription
        if (typeof initialiserPageInscription === 'function') {
            initialiserPageInscription();
            // Vérifier si on revient de Google
            if (typeof gererRetourGoogle === 'function') {
                gererRetourGoogle();
            }
        }
    } 
    else if (filename === 'home.html' || filename === '' || path === '/' || path.endsWith('/')) {
        // Page d'accueil
        if (typeof initialiserPageAccueil === 'function') {
            initialiserPageAccueil();
        }
    }
    else if (filename === 'historique_commande.html') {
        // Page historique
        if (typeof initialiserPageHistorique === 'function') {
            initialiserPageHistorique();
        }
    }
    else if (filename === 'annonces.html' || path.includes('annonces') || filename.includes('annonces')) {
        // Page annonces
        if (typeof initialiserPageAnnonces === 'function') {
            initialiserPageAnnonces();
        }
    }
    else if (filename === 'detail-annonce.html' || path.includes('detail-annonce') || filename.includes('detail-annonce')) {
        // Page détail annonce
        if (typeof initialiserPageDetail === 'function') {
            initialiserPageDetail();
        }
    }
    else if (filename === 'vendre.html' || path.includes('vendre') || filename.includes('vendre')) {
        // Page vendre
        if (typeof initialiserPageVendre === 'function') {
            initialiserPageVendre();
        }
    }
    else if (filename === 'mes-produits.html' || path.includes('mes-produits') || filename.includes('mes-produits')) {
        // Page mes produits
        if (typeof initialiserPageMesProduits === 'function') {
            initialiserPageMesProduits();
        }
    }
    else if (filename === 'historique-ventes.html') {
        // Page historique ventes
        if (typeof initialiserPageHistoriqueVentes === 'function') {
            initialiserPageHistoriqueVentes();
        }
    }
});


// ============================================
// EXPORT DES FONCTIONS GLOBALES
// ============================================

// Fonctions générales
window.goTo = goTo;
window.redirigerVersAnnonce = redirigerVersAnnonce;
window.rechercherAnnonces = rechercherAnnonces;

// Fonctions pour historique des commandes
window.toggleSelectionCommande = toggleSelectionCommande;
//window.supprimerCommandes = supprimerCommandes;
window.annulerCommande = annulerCommande;

// Fonctions pour annonces
window.changerPage = changerPageAnnonces;
window.resetFiltres = resetFiltresAnnonces;

// Fonctions pour détail annonce
window.ouvrirLightbox = ouvrirLightboxDetail;
window.changerImagePrincipale = changerImagePrincipaleDetail;
window.ouvrirAchat = ouvrirAchatDetail;
window.confirmerAchat = confirmerAchatDetail;

// Fonctions pour vendre
window.supprimerImage = supprimerImage;

// Fonctions pour mes produits
window.ouvrirModification = ouvrirModification;
window.confirmerSuppression = confirmerSuppression;