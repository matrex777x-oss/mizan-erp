'use strict';

class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, message, details);
const unauthorized = (message = 'يلزم تسجيل الدخول') => new AppError(401, message);
const forbidden = (message = 'لا تملك صلاحية لهذا الإجراء') => new AppError(403, message);
const notFound = (message = 'العنصر غير موجود') => new AppError(404, message);
const conflict = (message, details) => new AppError(409, message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
