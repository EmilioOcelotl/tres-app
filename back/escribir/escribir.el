;;; escribir.el --- emacs para `npm run escribir'  -*- lexical-binding: t -*-
;;
;; Lo carga back/escribir/sesion.js al abrir una nota, después de fijar:
;;   escribir-archivo-fin       archivo con el fin del bloque (segundos epoch)
;;   escribir-archivo-enlaces   lista de notas (clave TAB título TAB lugar),
;;                              o nil en las notas de código
;; No toca ~/.emacs.

(defvar escribir-archivo-fin nil)
(defvar escribir-archivo-enlaces nil)

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

(defun escribir--tic ()
  (let ((resta (- (escribir--fin) (float-time))))
    (setq escribir-modo
          (if (> resta 0)
              (format " ⏱ %d:%02d " (floor resta 60) (mod (floor resta) 60))
            " ⏱ ¡tiempo! "))
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

(defconst escribir--re-enlace
  "\\(\\[\\[\\(?:[^]\n]*› \\)?\\)\\([^]\n]+?\\)\\(\\]\\]\\)")
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

(defun escribir--cara-enlace ()
  (if (gethash (downcase (buffer-substring-no-properties
                          (+ (match-beginning 0) 2) (- (match-end 0) 2)))
               escribir--claves)
      'link
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
            m)
  (if escribir-enlaces-mode
      (progn
        (setq-local font-lock-keywords-only t)
        (font-lock-mode 1)
        (font-lock-add-keywords
         nil
         `((,escribir--re-enlace
            (1 '(face nil invisible escribir-oculto) prepend)
            (2 (escribir--cara-enlace) prepend)
            (3 '(face nil invisible escribir-oculto) prepend))
           (,escribir--re-enlace-viejo 0 'font-lock-warning-face prepend)))
        (setq-local font-lock-extra-managed-props
                    (cons 'invisible font-lock-extra-managed-props))
        (add-to-invisibility-spec 'escribir-oculto)
        (font-lock-flush))
    (remove-from-invisibility-spec 'escribir-oculto)
    (font-lock-flush)))

;;;; Arranque ───────────────────────────────────────────────────────────────

(defun escribir-iniciar ()
  (visual-line-mode 1)
  ;; Una lista de mode-line que empieza con un símbolo se lee como condicional
  ;; (y sale *invalid*): se arma empezando con "".
  (unless (memq 'escribir-modo (flatten-tree global-mode-string))
    (setq global-mode-string (list "" global-mode-string 'escribir-modo)))
  (run-at-time 0 1 #'escribir--tic)
  (when escribir-archivo-enlaces
    (escribir--leer-enlaces)
    (escribir-enlaces-mode 1)))

(provide 'escribir)
;;; escribir.el ends here
