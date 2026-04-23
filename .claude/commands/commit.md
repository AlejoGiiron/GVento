---
description: Crea un commit en formato Conventional Commits con el mensaje apropiado según los cambios staged.
argument-hint: [mensaje-opcional]
---

Crea un commit en el proyecto gvento siguiendo el flujo:

## 1. Verificar estado

Ejecuta `git status` y `git diff --staged` para ver qué hay en el stage. Si no hay nada staged, muestra los archivos modificados con `git diff --name-only` y pregunta cuáles incluir antes de continuar.

## 2. Determinar el mensaje

Si el usuario proporcionó un mensaje como argumento (`$ARGUMENTS`), úsalo como base y formatearlo en Conventional Commits. Si no hay argumento, analiza los cambios staged y genera el mensaje más apropiado.

**Formato obligatorio:**
```
<tipo>(<scope>): <descripción en español, imperativo, minúscula>

[cuerpo opcional si los cambios son complejos]
```

**Tipos válidos:**
- `feat` — nueva funcionalidad
- `fix` — corrección de bug
- `refactor` — cambio de código sin cambiar comportamiento
- `style` — cambios de formato/estilos sin lógica
- `test` — añadir o corregir tests
- `chore` — tareas de mantenimiento, deps, config
- `docs` — documentación

**Scope:** nombre del módulo o archivo principal afectado (ej. `auth`, `pos`, `mesas`, `layout`).

## 3. Confirmar antes de commitear

Muestra el mensaje propuesto y espera confirmación explícita del usuario antes de ejecutar el commit. No commitees sin aprobación.

## 4. Ejecutar el commit

```bash
git commit -m "$(cat <<'EOF'
<mensaje aprobado>
EOF
)"
```

## Restricciones
- Nunca hacer commit directo a `main`
- Nunca hacer commit directo a `develop` — solo a ramas `feature/*` o `hotfix/*`
- Un commit por funcionalidad o fix completo — si los staged incluyen cambios mezclados, advertirlo
- No usar `--no-verify`
- Después de ejecutar el commit, actualizar la sección "Estado actual del proyecto" en el `CLAUDE.md` raíz reflejando la funcionalidad que se acaba de commitear
