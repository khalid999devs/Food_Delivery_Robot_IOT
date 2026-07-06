function notFound(req, res) {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
    requestId: req.requestId
  });
}

module.exports = notFound;
