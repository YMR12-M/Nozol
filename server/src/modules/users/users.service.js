/**
 * إدارة الفريق (موظفو المنظّمة).
 *
 * القواعد التي تحمي المنظّمة من نفسها:
 *   • المالك وحده ينشئ مالكًا آخر أو يعدّل مالكًا.
 *   • لا يُخفَّض ولا يُوقَف ولا يُحذَف آخر مالك نشط (وإلا تُقفَل المنظّمة).
 *   • لا يعدّل المستخدم دوره أو حالته بنفسه (يمنع إقصاء النفس بالخطأ).
 *   • كل شيء داخل منظّمة المستخدم فقط.
 */
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction, placeholders } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { ROLE_LABELS } from '../../config/permissions.js';
import {
  generateTempPassword, hashPassword, randomToken, sha256,
} from '../../utils/security.js';
import { enqueueEmail } from '../../services/notifications/outbox.js';

const USER_COLUMNS = `u.id, u.uuid, u.full_name, u.email, u.phone, u.role, u.status,
  u.preferred_lang, u.must_change_password, u.last_login_at, u.created_at`;

async function attachProperties(users) {
  if (users.length === 0) return users;
  const links = await query(
    `SELECT user_id, property_id FROM user_properties WHERE user_id IN (${placeholders(users.length)})`,
    users.map((user) => user.id),
  );
  const byUser = new Map();
  for (const link of links) {
    if (!byUser.has(link.user_id)) byUser.set(link.user_id, []);
    byUser.get(link.user_id).push(link.property_id);
  }
  return users.map((user) => ({
    ...user,
    must_change_password: Boolean(user.must_change_password),
    property_ids: user.role === 'owner' ? null : (byUser.get(user.id) ?? []),
  }));
}

async function findInOrg(orgId, userId) {
  const user = await queryOne(
    `SELECT ${USER_COLUMNS}, u.organization_id FROM users u
      WHERE u.id = ? AND u.organization_id = ? AND u.deleted_at IS NULL`,
    [userId, orgId],
  );
  if (!user) throw ApiError.notFound('المستخدم غير موجود');
  return user;
}

async function assertPropertiesInOrg(orgId, ids) {
  if (!ids || ids.length === 0) return;
  const rows = await query(
    `SELECT id FROM properties WHERE organization_id = ? AND id IN (${placeholders(ids.length)})`,
    [orgId, ...ids],
  );
  if (rows.length !== new Set(ids).size) {
    throw ApiError.badRequest('منشأة غير موجودة ضمن منظّمتك', { code: 'BAD_PROPERTY' });
  }
}

const countActiveOwners = async (orgId, exceptUserId = 0) =>
  (await queryOne(
    `SELECT COUNT(*) AS n FROM users
      WHERE organization_id = ? AND role = 'owner' AND status = 'active' AND deleted_at IS NULL AND id <> ?`,
    [orgId, exceptUserId],
  )).n;

function assertCanTouch(actor, target) {
  if (target.role === 'owner' && actor.role !== 'owner') {
    throw ApiError.forbidden('المالك وحده يعدّل حساب مالك', { code: 'OWNER_ONLY' });
  }
}

export const usersService = {
  async list(actor, { role, status, q }) {
    const where = ['u.organization_id = ?', 'u.deleted_at IS NULL'];
    const params = [actor.organization_id];
    if (role) { where.push('u.role = ?'); params.push(role); }
    if (status) { where.push('u.status = ?'); params.push(status); }
    if (q) {
      where.push('(u.full_name LIKE ? OR u.email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const rows = await query(
      `SELECT ${USER_COLUMNS} FROM users u WHERE ${where.join(' AND ')} ORDER BY u.role, u.full_name`,
      params,
    );
    return attachProperties(rows);
  },

  async get(actor, id) {
    const [user] = await attachProperties([await findInOrg(actor.organization_id, id)]);
    return user;
  },

  async create(actor, payload) {
    if (payload.role === 'owner' && actor.role !== 'owner') {
      throw ApiError.forbidden('المالك وحده ينشئ مالكًا', { code: 'OWNER_ONLY' });
    }
    await assertPropertiesInOrg(actor.organization_id, payload.property_ids);

    if (await queryOne('SELECT id FROM users WHERE email = ?', [payload.email])) {
      throw ApiError.conflict('البريد ده مستخدم بالفعل', { code: 'EMAIL_TAKEN', details: { email: 'مستخدم بالفعل' } });
    }

    const useInvite = payload.send_invite && !payload.password;
    const plain = payload.password || generateTempPassword();
    // دعوة بالبريد: كلمة عشوائية لا يعرفها أحد حتى يحدّد الموظف كلمته من الرابط
    const passwordHash = await hashPassword(useInvite ? randomToken(32) : plain);

    const userId = await transaction(async (tx) => {
      const result = await tx.execute(
        `INSERT INTO users (uuid, organization_id, full_name, email, phone, password_hash, role, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [crypto.randomUUID(), actor.organization_id, payload.full_name, payload.email, payload.phone ?? null, passwordHash, payload.role],
      );
      if (payload.role !== 'owner') {
        for (const propertyId of new Set(payload.property_ids)) {
          await tx.execute('INSERT INTO user_properties (user_id, property_id) VALUES (?, ?)', [result.insertId, propertyId]);
        }
      }

      if (useInvite) {
        const token = randomToken(48);
        await tx.execute(
          'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 72 HOUR))',
          [result.insertId, sha256(token)],
        );
        await enqueueEmail({
          to: payload.email,
          template: 'staff_invite',
          payload: {
            name: payload.full_name,
            email: payload.email,
            role: ROLE_LABELS[payload.role],
            link: `${env.appUrl}/reset-password?token=${token}&invite=1`,
          },
        }, tx);
      }
      return result.insertId;
    });

    const user = await this.get(actor, userId);
    // كلمة المرور المؤقتة تُعرض مرّة واحدة هنا ولا تُخزَّن بنص صريح في أي مكان
    return { user, temp_password: useInvite || payload.password ? null : plain };
  },

  async update(actor, id, changes) {
    const target = await findInOrg(actor.organization_id, id);
    assertCanTouch(actor, target);

    const touchesRole = changes.role !== undefined && changes.role !== target.role;
    const touchesStatus = changes.status !== undefined && changes.status !== target.status;

    if (id === actor.id && (touchesRole || touchesStatus)) {
      throw ApiError.forbidden('مينفعش تغيّر دورك أو حالتك بنفسك', { code: 'SELF_CHANGE' });
    }
    if (changes.role === 'owner' && actor.role !== 'owner') {
      throw ApiError.forbidden('المالك وحده يرقّي لمالك', { code: 'OWNER_ONLY' });
    }
    const losesOwnership = target.role === 'owner'
      && ((touchesRole && changes.role !== 'owner') || changes.status === 'suspended');
    if (losesOwnership && (await countActiveOwners(actor.organization_id, id)) === 0) {
      throw ApiError.conflict('لازم يفضل مالك نشط واحد على الأقل', { code: 'LAST_OWNER' });
    }
    if (changes.property_ids) await assertPropertiesInOrg(actor.organization_id, changes.property_ids);

    await transaction(async (tx) => {
      const sets = [];
      const params = [];
      for (const column of ['full_name', 'phone', 'role', 'status']) {
        if (changes[column] !== undefined) { sets.push(`${column} = ?`); params.push(changes[column]); }
      }
      if (sets.length > 0) await tx.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);

      if (changes.property_ids !== undefined) {
        await tx.execute('DELETE FROM user_properties WHERE user_id = ?', [id]);
        for (const propertyId of new Set(changes.property_ids)) {
          await tx.execute('INSERT INTO user_properties (user_id, property_id) VALUES (?, ?)', [id, propertyId]);
        }
      }
      // إيقاف الحساب أو تغيير دوره يُنهي جلساته فورًا
      if (changes.status === 'suspended' || touchesRole) {
        await tx.execute('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
      }
    });

    return { before: target, after: await this.get(actor, id) };
  },

  async remove(actor, id) {
    const target = await findInOrg(actor.organization_id, id);
    assertCanTouch(actor, target);
    if (id === actor.id) throw ApiError.forbidden('مينفعش تحذف حسابك', { code: 'SELF_DELETE' });
    if (target.role === 'owner' && (await countActiveOwners(actor.organization_id, id)) === 0) {
      throw ApiError.conflict('مينفعش تحذف آخر مالك', { code: 'LAST_OWNER' });
    }

    await transaction(async (tx) => {
      // نحرّر البريد (UNIQUE) ليُستخدم لحساب جديد، ونُبقي الصفّ لسلامة السجلات التاريخية
      await tx.execute(
        `UPDATE users SET deleted_at = NOW(), status = 'suspended',
                email = LEFT(CONCAT('deleted-', id, '-', email), 190)
          WHERE id = ?`,
        [id],
      );
      await tx.execute('DELETE FROM user_properties WHERE user_id = ?', [id]);
      await tx.execute('DELETE FROM push_subscriptions WHERE user_id = ?', [id]);
      await tx.execute('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
    });
    return target;
  },

  /** كلمة مرور مؤقتة جديدة تُعرض مرّة واحدة (لموظف نسي ولا يصله البريد) */
  async issueTempPassword(actor, id) {
    const target = await findInOrg(actor.organization_id, id);
    assertCanTouch(actor, target);
    if (id === actor.id) throw ApiError.forbidden('غيّر كلمة مرورك من الإعدادات', { code: 'SELF_CHANGE' });

    const plain = generateTempPassword();
    await transaction(async (tx) => {
      await tx.execute(
        'UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?',
        [await hashPassword(plain), id],
      );
      await tx.execute('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
    });
    return { user: target, temp_password: plain };
  },
};
