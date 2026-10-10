;;; escribir.el --- emacs para `npm run escribir'  -*- lexical-binding: t -*-
;;
;; Lo carga back/escribir/sesion.js al abrir una nota, después de fijar:
;;   escribir-archivo-fin       archivo con el fin del bloque (segundos epoch)
;;   escribir-archivo-enlaces   lista de notas (clave TAB título TAB lugar),
;;                              o nil en las notas de código
;;   escribir-umbral            palabras para que la nota cuente como completa
;; No toca ~/.emacs.

(defvar escribir-archivo-fin nil)
(defvar escribir-archivo-enlaces nil)
(defvar escribir-umbral nil)

;;;; Timer de la sesión ─────────────────────────────────────────────────────
;; Sólo avisa: no guarda ni cierra. El fin vive en un archivo que comparte con
;; el programa, así `escribir-mas' alarga el bloque para los dos.

(defvar escribir-modo "")
(put 'escribir-modo 'risky-local-variable t)
(defvar escribir--avisado nil)

(defun escribir--fin ()
  (with-temp-buffer
    (insert-file-contents escribir-archivo-fin)
    (string-to-number (buffer-string))))

;; Junto al reloj, las palabras de la nota contra el umbral (` 87/150w').
;; Cuenta igual que el programa (`palabras' en local.js), que parte el HTML
;; en las etiquetas: un enlace cuenta como su título con espacios alrededor y
;; una figura, como las palabras de su pie (del bloque guardado, no de la
;; marca, que lo trae recortado). Sin comentarios `//'. Se recuenta sólo si el
;; texto cambió.

(defvar escribir--buffer nil)
(defvar escribir--conteo '(-1 . 0))
(defvar escribir--figuras nil "Palabras de cada figura de la nota, en orden.")

(defun escribir--palabras-html (html)
  (length (split-string (replace-regexp-in-string "<[^>]*>" " " html) nil t)))

(defun escribir--leer-figuras ()
  (let ((f (expand-file-name
            (concat "bloques/" (file-name-base (buffer-file-name escribir--buffer)) ".json")
            (file-name-directory escribir-archivo-enlaces))))
    (setq escribir--figuras
          (and (file-exists-p f)
               (with-temp-buffer
                 (insert-file-contents f)
                 (mapcar #'escribir--palabras-html (json-parse-buffer :array-type 'list)))))))

(defun escribir--contar ()
  (with-current-buffer escribir--buffer
    (let ((tick (buffer-chars-modified-tick)))
      (unless (eql tick (car escribir--conteo))
        (let ((texto (buffer-substring-no-properties (point-min) (point-max)))
              (figuras 0))
          (if (not escribir-archivo-enlaces)
              (setq texto (replace-regexp-in-string "<[^>]*>" " " texto))
            (setq texto (replace-regexp-in-string
                         "<!-- trilium:bloque \\([0-9]+\\).*-->"
                         (lambda (m)
                           (cl-incf figuras (or (nth (1- (string-to-number (match-string 1 m)))
                                                     escribir--figuras)
                                                0))
                           " ")
                         texto))
            (dolist (r '(("\\[\\[\\(?:[^]\n]*› \\)?\\(?:[^]|\n]*|\\)?\\([^]\n]*\\)\\]\\]" . " \\1 ")
                         ("\\[\\([^]\n]*\\)\\]([^)\n]*)" . " \\1 ")
                         ("\\(^\\|[^:/]\\)//.*$" . "\\1")
                         ("^[ \t]*\\(?:#+\\|[-*+]\\|[0-9]+\\.\\|>\\)[ \t]+" . "")
                         ("\\\\\\([[:punct:]]\\)" . "\\1")
                         ("[*`]+" . " ")))
              (setq texto (replace-regexp-in-string (car r) (cdr r) texto))))
          (setq escribir--conteo
                (cons tick (+ figuras (length (split-string texto nil t))))))))
    (cdr escribir--conteo)))

(defun escribir--tic ()
  (let ((resta (- (escribir--fin) (float-time)))
        (w (if (buffer-live-p escribir--buffer) (escribir--contar) 0)))
    (setq escribir-modo
          (concat
           (if (> resta 0)
               (format " ⏱ %d:%02d" (floor resta 60) (mod (floor resta) 60))
             " ⏱ ¡tiempo!")
           (if escribir-umbral (format " · %d/%dw " w escribir-umbral) (format " · %dw " w))))
    (when (and (<= resta 0) (not escribir--avisado))
      (setq escribir--avisado t)
      (ding)
      (message "Bloque cumplido. Guarda (C-x C-s) y cierra (C-x C-c) cuando quieras · M-x escribir-mas para seguir"))
    (force-mode-line-update t)))

(defun escribir-mas (min)
  "Alarga el bloque de trabajo MIN minutos."
  (interactive "nMinutos más: ")
  (with-temp-file escribir-archivo-fin
    (insert (number-to-string (+ (max (escribir--fin) (float-time)) (* 60 min)))))
  (setq escribir--avisado nil)
  (escribir--tic))

;;;; Enlaces internos ───────────────────────────────────────────────────────
;; Como el @ de Trilium: `@' abre una búsqueda de notas por nombre y Enter
;; inserta [[clave]]. En pantalla se ve sólo el título, en azul; los corchetes
;; y la ruta que desambigua (`Parte III - Archivos comprimidos › Léeme') quedan
;; ocultos. Retroceso justo después de un enlace lo borra entero. Un enlace a
;; una nota que no existe se pinta como advertencia.
;;
;; Con texto propio, `[[clave|texto]]' (citas con página o «citado en»): la
;; clave de la ficha y la barra se ven en gris y el texto que se imprime, en
;; azul.

(defconst escribir--re-enlace
  "\\(\\[\\[\\(?:[^]|\n]*› \\)?\\)\\([^]|\n]+?\\)\\(?:\\(|\\)\\([^]\n]+?\\)\\)?\\(\\]\\]\\)")
(defconst escribir--re-enlace-viejo "\\[[^]\n]*\\](#root/[^)\n]*)")

(defvar escribir--candidatos nil)
(defvar escribir--claves (make-hash-table :test 'equal))

(defun escribir--leer-enlaces ()
  (setq escribir--candidatos nil)
  (clrhash escribir--claves)
  (with-temp-buffer
    (insert-file-contents escribir-archivo-enlaces)
    (dolist (linea (split-string (buffer-string) "\n" t))
      (let ((c (split-string linea "\t")))
        (puthash (downcase (nth 0 c)) t escribir--claves)
        (push (cons (concat (nth 1 c) "   " (propertize (or (nth 2 c) "") 'face 'shadow))
                    (nth 0 c))
              escribir--candidatos))))
  (setq escribir--candidatos (nreverse escribir--candidatos)))

(defun escribir--cara-enlace (&optional con-texto)
  "Cara de la clave: azul (o gris si el enlace trae texto propio) si existe."
  (if (gethash (downcase (buffer-substring-no-properties
                          (+ (match-beginning 0) 2) (match-end 2)))
               escribir--claves)
      (if con-texto 'shadow 'link)
    'font-lock-warning-face))

(defun escribir-arroba ()
  "Busca una nota por nombre e inserta un enlace a ella.
Pegada a una letra (un correo) o al cancelar con C-g, escribe un @ normal."
  (interactive)
  (if (and (char-before) (string-match-p "[[:alnum:]]" (string (char-before))))
      (insert "@")
    (let* ((activo (bound-and-true-p fido-vertical-mode))
           (eleccion
            (condition-case nil
                (let ((completion-ignore-case t))
                  (unwind-protect
                      (progn (unless activo (fido-vertical-mode 1))
                             (completing-read "Enlace a: " escribir--candidatos nil t))
                    (unless activo (fido-vertical-mode -1))))
              (quit nil)))
           (par (and eleccion (assoc eleccion escribir--candidatos))))
      (if par (insert "[[" (cdr par) "]]") (insert "@")))))

;;;; Citas ──────────────────────────────────────────────────────────────────
;; Una línea que empieza con `> ' es una cita en bloque (<blockquote> en
;; Trilium, sangrada en el PDF): el `>' en gris, el texto en otro tono y las
;; líneas largas continúan con sangría. La referencia va dentro del bloque, al
;; final, como en APA.
;;
;; `"' escribe comillas tipográficas: “ al abrir (inicio de línea, tras un
;; espacio o tras ( [ — > “) y ” en los demás casos. C-q " escribe la recta.

(defface escribir-cita '((t :inherit font-lock-doc-face))
  "Texto de una cita en bloque.")

(defconst escribir--re-cita "^\\(>[ \t]?\\)\\(.*\\)$")

(defun escribir-comillas ()
  "Comilla tipográfica de apertura o de cierre según lo que hay antes."
  (interactive)
  (insert (if (or (bolp) (memq (char-before) '(?\s ?\t ?\n ?\( ?\[ ?— ?> ?“ ?«)))
              "“" "”")))

(defun escribir-borrar ()
  "Retroceso: si justo antes del cursor hay un enlace, lo borra entero."
  (interactive)
  (if (and (eq (char-before) ?\]) (not (use-region-p))
           (save-excursion (looking-back escribir--re-enlace (line-beginning-position))))
      (delete-region (match-beginning 0) (match-end 0))
    (call-interactively #'delete-backward-char)))

(define-minor-mode escribir-enlaces-mode
  "Enlaces internos de Trilium: @ busca una nota, el título se ve en azul."
  :keymap (let ((m (make-sparse-keymap)))
            (define-key m "@" #'escribir-arroba)
            (define-key m (kbd "DEL") #'escribir-borrar)
            (define-key m "\"" #'escribir-comillas)
            m)
  (if escribir-enlaces-mode
      (progn
        (setq-local font-lock-keywords-only t)
        (font-lock-mode 1)
        (font-lock-add-keywords
         nil
         `((,escribir--re-cita
            (1 'shadow prepend)
            (2 'escribir-cita prepend)
            (0 '(face nil wrap-prefix "  ") prepend))
           (,escribir--re-enlace
            (1 '(face nil invisible escribir-oculto) prepend)
            (2 (escribir--cara-enlace (match-beginning 4)) prepend)
            (3 'shadow prepend t)
            (4 'link prepend t)
            (5 '(face nil invisible escribir-oculto) prepend))
           (,escribir--re-enlace-viejo 0 'font-lock-warning-face prepend)))
        (setq-local font-lock-extra-managed-props
                    (append '(invisible wrap-prefix) font-lock-extra-managed-props))
        (add-to-invisibility-spec 'escribir-oculto)
        (font-lock-flush))
    (remove-from-invisibility-spec 'escribir-oculto)
    (font-lock-flush)))

;;;; Ortografía ─────────────────────────────────────────────────────────────
;; jinx (GNU ELPA, sobre enchant) con español genérico e inglés a la vez: la
;; tesis los mezcla todo el tiempo. Siempre encendido; M-$ corrige la palabra
;; bajo el cursor. Las palabras propias viven en palabras.txt, junto a este
;; archivo y versionadas: `@palabra' en M-$ la agrega ahí, `+palabra' sólo
;; por la sesión. No se revisan enlaces [[…]], código entre comillas
;; invertidas ni las marcas de figura. Sin jinx instalado, no hace nada.

(defconst escribir--palabras
  (expand-file-name "palabras.txt" (file-name-directory (or load-file-name buffer-file-name))))

(defconst escribir--re-no-prosa "\\[\\[[^]\n]*\\]\\]\\|`[^`\n]+`\\|<!--.*-->")

(defun escribir--leer-palabras ()
  (when (file-exists-p escribir--palabras)
    (with-temp-buffer
      (insert-file-contents escribir--palabras)
      (seq-remove (lambda (l) (string-prefix-p "#" l))
                  (split-string (buffer-string) "\n" t "[ \t]+")))))

(defun escribir--escribir-palabras (palabras)
  "Reescribe palabras.txt con PALABRAS, conservando el encabezado."
  (let ((encabezado
         (with-temp-buffer
           (insert-file-contents escribir--palabras)
           (goto-char (point-min))
           (while (looking-at-p "#") (forward-line 1))
           (buffer-substring-no-properties (point-min) (point)))))
    (with-temp-file escribir--palabras
      (insert encabezado)
      (dolist (p (sort (delete-dups palabras)
                       (lambda (a b) (string-collate-lessp a b nil t))))
        (insert p "\n")))))

(defun escribir--guardar-palabra (accion tecla palabra)
  "Guarda o quita PALABRA en palabras.txt (acción de guardado de jinx)."
  (pcase-exhaustive accion
    ('add (escribir--escribir-palabras (cons palabra (escribir--leer-palabras)))
          (add-to-list 'jinx--session-words palabra))
    ('remove (escribir--escribir-palabras (remove palabra (escribir--leer-palabras)))
             (setq jinx--session-words (remove palabra jinx--session-words)))
    ('has (member palabra (escribir--leer-palabras)))
    ('format `((,(char-to-string tecla) ,palabra "palabras.txt")))))

(defun escribir--fuera-de-prosa (pos)
  "Si POS cae en un enlace, código o marca de figura, salta al final."
  (save-excursion
    (goto-char (line-beginning-position))
    (catch 'fin
      (while (re-search-forward escribir--re-no-prosa (line-end-position) t)
        (cond ((> (match-beginning 0) pos) (throw 'fin nil))
              ((< pos (match-end 0)) (throw 'fin (match-end 0))))))))

(defun escribir-ortografia ()
  (when (require 'jinx nil t)
    (setq-local jinx-languages "es en_US"
                jinx-dir-local-words (string-join (escribir--leer-palabras) " "))
    (setq-local jinx--save-keys `((?@ . ,#'escribir--guardar-palabra)
                                  (?+ . ,#'jinx--save-session)))
    (setq-local jinx--predicates (cons #'escribir--fuera-de-prosa jinx--predicates))
    (keymap-set jinx-mode-map "M-$" #'jinx-correct)
    (setf (alist-get 'jinx-mode minor-mode-alist) '(""))
    (jinx-mode 1)))

;;;; Arranque ───────────────────────────────────────────────────────────────

(defun escribir-iniciar ()
  (setq escribir--buffer (current-buffer))
  (when escribir-archivo-enlaces (escribir--leer-figuras))
  (visual-line-mode 1)
  ;; El reloj va al principio de la línea de modo: al final se pierde en una
  ;; terminal angosta. Una lista de mode-line que empieza con un símbolo se lee
  ;; como condicional (y sale *invalid*): se arma empezando con "".
  (unless (memq 'escribir-modo (flatten-tree (default-value 'mode-line-format)))
    (setq-default mode-line-format
                  (list "" 'escribir-modo (default-value 'mode-line-format))))
  ;; Sin «Wrap» ni «Jinx[es en_US]»: ocupan lugar y siempre están encendidos.
  (setf (alist-get 'visual-line-mode minor-mode-alist) '(""))
  (run-at-time 0 1 #'escribir--tic)
  (when escribir-archivo-enlaces
    (escribir--leer-enlaces)
    (escribir-enlaces-mode 1))
  (escribir-ortografia))

(provide 'escribir)
;;; escribir.el ends here
